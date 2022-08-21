#!/usr/bin/env node

import {
    RabbitMQ,
    SqlDB,
    GoogleAdmin,
    AppleAPNs,
    Logger,
    Roles,
    deepCopy,
    System
} from 'ikomida-shared'
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
    .replace(/^\w/, m => m.toUpperCase())
    .replace(/-\w/g, m => m[1].toUpperCase())

class PushNotificationWorker {

    googleAdmin
    appleAPNs
    amqp
    logger

    constructor() {
        this.logger = Logger.getInstance(name, process.env?.ENV !== 'PROD')
    }

    async run() {
        try {
            this.googleAdmin = new GoogleAdmin(this.logger)
            this.appleAPNs = new AppleAPNs(this.logger)
            this.amqp = new RabbitMQ(this.logger)
            await this.amqp.listenToMessages(RabbitMQ.PUSH_NOTIFICATION_QUEUE, this.processMessages.bind(this))
        } catch (error) {
            this.logger.error(error)
        }
    }

    async processMessages(payload, channel) {
        try {
            this.logger.log(` [x] ${payload.fields.routingKey}: payload received: '${payload.content.toString('utf8')}'`)
            const messageObject = JSON.parse(payload.content.toString('utf8'))
            if (messageObject.method === 'send') {
                const contractModel = await SqlDB.ContractModel.findOne({
                    where: {
                        id: messageObject.object.contractId,

                    },
                    include: [{
                        model: SqlDB.PNModel,
                        where: {
                            role: Roles.VENDOR,

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
                if (messageObject.object.userId) {
                    const userModels = await contractModel.getUsers({
                        where: {
                            id: messageObject.object.userId,

                        },
                        include: [{
                            model: SqlDB.PNModel,
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
                    pNModel = pNModels[0]
                }
                if (pNModel) {
                    const message = deepCopy(messageObject?.object?.message)
                    const pNMessageModel = await pNModel.createPNMessage({
                        title: message?.notification?.title,
                        body: message?.notification?.body,
                        data: JSON.stringify(message?.data)
                    })

                    await pNMessageModel.setContract(contractModel)

                    if (messageObject.object.userId) {
                        await pNMessageModel.setUser(userModel)
                    }

                    let i = 0
                    let seconds = new Date().getTime()
                    do {
                        message.token = pNModel?.token
                        message.id = pNMessageModel?.id
                        message.priority = 10
                        message.ikomidaId = contractModel?.ikomidaId
                        i++
                        const response = await this.sendPushNotificationByToken(pNMessageModel, message, pNModel?.platform)
                        switch (response) {
                            case 0:
                                this.logger.log(` [x] Push notification enviado com sucesso`)
                                channel.ack(payload)
                                return true
                            case 1:
                                this.logger.warn(` [x] Push notification não foi enviado, token não foi localizado`)
                                pNModel?.destroy()
                                channel.ack(payload)
                                return true
                            case -1:
                                if (i < 3) {
                                    seconds += i
                                    await System.sleep(i * 1000)
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
                this.logger.log(` [Erro]: O metodo: ${messageObject?.method} não suportado!`)
            }
        } catch (error) {
            this.logger.error(error)
        }
        return false
    }

    async sendPushNotificationByToken(model, payload, platform) {
        let response = { code: -1 }
        try {
            if (platform === 'android') {
                response = await this.googleAdmin.sendPushNotification(payload)
            } else {
                response = await this.appleAPNs.sendPushNotification(payload)
            }
            if (response?.code === 0) {
                model.remoteId = response?.id
                model.send = true
                model.save()
            }
        } catch (error) {
            this.logger.log("payload:", payload)
            this.logger.error(error)
        }
        return response
    }
}

await (new PushNotificationWorker).run()