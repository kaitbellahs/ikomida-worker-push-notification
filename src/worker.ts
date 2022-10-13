import { Domain, DBModels, Types, BackendTypes, Utils } from '@ikomida/shared-backend'
import { Message, Channel } from 'amqplib'
import { createRequire } from 'module'
import { Includeable } from 'sequelize'
const require = createRequire(import.meta.url)
let { name } = require('../package.json')
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
      const payload: Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject> =
        Types.Classes.CAMQPPayload.fromObject(JSON.parse(message.content.toString('utf8')))
      console.log('payload:', payload)
      const payloadObject: Types.Classes.CAMQPPayloadObject = Types.Classes.CAMQPPayloadObject.fromObject(
        payload.object
      )
      console.log('payloadObject:', payloadObject)
      if (payload.method === 'send') {
        const include: Includeable = payloadObject.userId
          ? {
            model: DBModels.UserModel,
            where: {
              id: payloadObject.userId
            },
            include: [
              {
                model: DBModels.PNModel,
                required: false
              }
            ],
            required: false
          }
          : {
            model: DBModels.PNModel,
            where: {
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF]
              }
            },
            required: false
          }
        const contractModel = await DBModels.ContractModel.findOne({
          where: {
            id: payloadObject.contractId
          },
          include
        })

        if (!contractModel) {
          this.logger.log(` [Erro]: Não foi localizado um estabelecimento!!`)
          channel.ack(message)
          return false
        }
        let pNModels
        let userModel
        if (payloadObject.userId) {
          const userModels = contractModel.users
          if (userModels?.length !== 1) {
            this.logger.log(` [Erro]: Não foi possível localizar o usuário para o envio de push notification!!`)
            channel.ack(message)
            return false
          }
          userModel = userModels?.[0]
          pNModels = [userModel?.pN]
        } else {
          pNModels = contractModel.pNs
        }
        if (!pNModels) {
          this.logger.log(
            ` [Erro]: Não foi possível localizar token do usuário ou dispositivo para o envio de push notification!!`
          )
          channel.ack(message)
          return false
        }
        const pNmessage: Types.Classes.CNotificationPayload = Types.Classes.CNotificationPayload.fromObject(
          payloadObject.message
        )
        console.log('pNmessage:', pNmessage)
        for (const pNModel of pNModels) {
          if (!pNModel) {
            this.logger.log(
              ` [Erro]: Não foi possível localizar token do usuário ou dispositivo para o envio de push notification!!`
            )
            continue
          }
          const pNMessageModel = await pNModel.$create('pNMessage', {
            title: pNmessage?.notification?.title,
            body: pNmessage.notification?.body,
            data: pNmessage.data,
            contractId: contractModel.id,
            userId: userModel?.id
          })

          let i = 0
          let seconds = new Date().getTime()
          do {
            pNmessage.token = pNModel?.token
            pNmessage.id = pNMessageModel?.id
            pNmessage.priority = 10
            pNmessage.ikomidaId = contractModel.ikomidaID
            i++
            const response = await this.sendPushNotificationByToken(pNMessageModel, pNmessage, pNModel.platform)
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
                channel.ack(message)
                return false
            }
          } while (i < 4)
          this.logger.log(
            ` [Erro]: O Push notification não foi enviado após ${i} tentativas wm ${(new Date().getTime() - seconds) / 1000
            } segundos!`
          )
        }
      } else {
        this.logger.log(` [Erro]: O metodo: ${payload?.method} não suportado!`)
        channel.ack(message)
        return false
      }
    } catch (error: any) {
      this.logger.error(error)
    }
    channel.nack(message)
    return false
  }

  async sendPushNotificationByToken(
    model: DBModels.PNMessageModel,
    message: Types.Classes.CNotificationPayload,
    platform?: string
  ) {
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
      this.logger.log('sendPushNotificationByToken:', message)
      this.logger.error(error)
    }
    return response
  }
}

await new PushNotificationWorker().run()
