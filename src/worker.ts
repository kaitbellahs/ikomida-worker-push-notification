import { Domain, DBModels, Types, BackendTypes, Utils } from '@ikomida/shared-backend';
import { Message, Channel } from 'amqplib';
import {
    createRequire
} from "module"
const require = createRequire(
    import.meta.url)
let {
    name
} = require("../package.json")
name = name
    .replace(/^(@\S+\/)?(svelte-)?(\S+)/, '$3')
    .replace(/^\w/, (m: string) => m.toUpperCase())
    .replace(/-\w/g, (m: string[]) => m[1].toUpperCase())
class PushNotificationWorker {

    googleAdmin?: Utils.GoogleAdmin
    appleAPNs?: Utils.AppleAPNs
    amqp?: Domain.RabbitMQ
    logger: Utils.Logger

    constructor() {
        this.logger = Utils.Logger.getInstance(name)
    }

    async run() {
        try {
            this.googleAdmin = new Utils.GoogleAdmin(this.logger)
            this.appleAPNs = new Utils.AppleAPNs(this.logger)
            this.amqp = new Domain.RabbitMQ(this.logger)
            await this.amqp.listenToMessages(Domain.RabbitMQ.PUSH_NOTIFICATION_QUEUE, this.processMessages.bind(this))
        } catch (error: any) {
            this.logger.error(error)
        }
    }

    async processMessages(message: Message, channel: Channel) {
        try {
            this.logger.log(` [x] ${message.fields.routingKey}: message received: '${message.content.toString('utf8')}'`)
            const payload: Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject> = Types.Classes.CAMQPPayload.fromObject(JSON.parse(message.content.toString('utf8')))
            const payloadObject: Types.Classes.CAMQPPayloadObject = Types.Classes.CAMQPPayloadObject.fromObject(payload.object)
            if (payload.method === 'send') {
                const contractModel = await DBModels.ContractModel.findOne({
                    where: {
                        id: payloadObject.contractId,

                    },
                    include: [{
                        model: DBModels.PNModel,
                        where: {
                            role: BackendTypes.Roles.VENDOR,

                        },
                        required: false,
                    }]
                }
                )

                if (!contractModel) {
                    this.logger.log(` [Erro]: Não foi localizado um estabelecimento!!`)
                    return false
                }
                let pNModel
                let userModel
                if (payloadObject.userId) {
                    const userModels = await contractModel.$get('users', {
                        where: {
                            id: payloadObject.userId,

                        },
                        include: [{
                            model: DBModels.PNModel,
                            where: {

                            },
                            required: false,
                        }]
                    })

                    if (userModels.length !== 1) {
                        this.logger.log(` [Erro]: Não foi possível localizar o usuário para o envio de push notification!!`)
                        return false
                    }
                    userModel = userModels?.[0]
                    pNModel = userModel?.pN
                } else {
                    const pNModels = contractModel?.pNs
                    if ((pNModels?.length ?? 0) !== 1) {
                        this.logger.log(` [Erro]: foi localizado mais de um push notification token no sistema!`)
                        return false
                    }
                    pNModel = pNModels?.[0]
                }
                if (pNModel) {
                    const pNmessage = payloadObject?.message as Types.Classes.CNotificationPayload
                    const pNMessageModel = await pNModel.$create('pNMessage', {
                        title: pNmessage?.notification?.title,
                        body: pNmessage?.notification?.body,
                        data: JSON.stringify(pNmessage?.data)
                    })
                    await contractModel.$add('pNs', pNMessageModel)

                    if (payloadObject.userId) {
                        await userModel?.$add('pNs', pNMessageModel)
                    }

                    let i = 0
                    let seconds = new Date().getTime()
                    do {
                        pNmessage.token = pNModel?.token
                        pNmessage.id = pNMessageModel?.id
                        pNmessage.priority = 10
                        pNmessage.ikomidaId = contractModel?.ikomidaID
                        i++
                        const response = await this.sendPushNotificationByToken(pNMessageModel, pNmessage, pNModel?.platform)
                        switch (response?.code) {
                            case 0:
                                this.logger.log(` [x] Push notification enviado com sucesso`)
                                channel.ack(message)
                                return true
                            case 1:
                                this.logger.warn(` [x] Push notification não foi enviado, token não foi localizado`)
                                await pNModel?.destroy()
                                channel.ack(message)
                                return true
                            case -1:
                                if (i < 3) {
                                    seconds += i
                                    await Utils.System.sleep(i * 1000)
                                }
                                break
                            default:
                                return false
                        }
                    } while (i < 4)
                    this.logger.log(` [Erro]: O Push notification não foi enviado após ${i} tentativas wm ${(new Date().getTime() - seconds) / 1000} segundos!`)
                } else {
                    this.logger.log(` [Erro]: Não foi possível localizar token do usuário ou dispositivo para o envio de push notification!!`)
                }
            } else {
                this.logger.log(` [Erro]: O metodo: ${payload?.method} não suportado!`)
            }
        } catch (error: any) {
            this.logger.error(error)
        }
        return false
    }

    async sendPushNotificationByToken(model: DBModels.PNMessageModel, message: Types.Classes.CNotificationPayload, platform?: string) {
        let response: Types.Types.TSendReturn = { code: -1 }
        try {
            if (platform === 'android') {
                response = await this.googleAdmin?.sendPushNotification(message)
            } else {
                response = await this.appleAPNs?.sendPushNotification(message)
            }
            if (response?.code === 0) {
                model.remoteId = response?.id
                model.send = true
                model.save()
            }
        } catch (error: any) {
            this.logger.log("message:", message)
            this.logger.error(error)
        }
        return response
    }
}

await (new PushNotificationWorker).run()