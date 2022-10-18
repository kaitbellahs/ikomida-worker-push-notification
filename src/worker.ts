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
    let transaction: Domain.SqlDB.Transaction | undefined = undefined
    try {
      this.logger.log(` [x] ${message.fields.routingKey}: message received: '${message.content.toString('utf8')}'`)
      const payload: Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject> =
        Types.Classes.CAMQPPayload.fromObject(JSON.parse(message.content.toString('utf8')))
      const payloadObject: Types.Classes.CAMQPPayloadObject = Types.Classes.CAMQPPayloadObject.fromObject(
        payload.object
      )
      if (payload.method === 'send') {
        const where = payloadObject.userId
          ? {
            id: payloadObject.userId
          } : {
            role: {
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF]
            }
          }
        const contractModel = await DBModels.ContractModel.findOne({
          where: {
            id: payloadObject.contractId
          },
          include: {
            model: DBModels.UserModel,
            where,
            include: [
              {
                model: DBModels.PNModel,
                required: false
              }
            ],
            required: false
          }
        })

        if (!contractModel) {
          this.logger.log(` [Erro]: Não foi localizado um estabelecimento!!`)
          channel.ack(message)
          return false
        }
        const userModels = contractModel.users
        if (!userModels || userModels.length <= 0) {
          this.logger.log(` [Erro]: Não foi possível localizar o usuários para o envio de push notification!!`)
          channel.ack(message)
          return false
        }
        const pNmessage: Types.Classes.CNotificationPayload = Types.Classes.CNotificationPayload.fromObject(
          payloadObject.message
        )
        for (const userModel of userModels) {
          const pNModel = userModel.pN
          if (!pNModel) {
            this.logger.log(
              ` [Erro]: Não foi possível localizar token do usuário ou dispositivo para o envio de push notification!!`
            )
            channel.ack(message)
            continue
          }

          let n = 0
          const startTime = new Date().getTime()
          let i = 0
          do {
            transaction = await Domain.SqlDB.sequelize.transaction({
              autocommit: false
            })
            const pNMessageModel = await pNModel.$create(
              'pNMessage',
              {
                title: pNmessage.notification?.title,
                body: pNmessage.notification?.body,
                data: pNmessage.data?.toJSON(),
                contractId: contractModel.id,
                userId: userModel.id
              },
              { transaction }
            )
            pNmessage.token = pNModel.token
            pNmessage.id = pNMessageModel?.id
            pNmessage.priority = 10
            if (userModel.role) {
              pNmessage.ikomidaId = BackendTypes.Roles.isVendor(userModel.role) ? 'com.ikomida.br.vendor' : BackendTypes.Roles.isInternal(userModel.role) ? 'com.ikomida.br.admin' : BackendTypes.Roles.isReseller(userModel.role) ? 'com.ikomida.br.reseller' : contractModel.ikomidaID
            }
            i++
            const response = await this.sendPushNotificationByToken(
              pNMessageModel,
              pNmessage,
              transaction,
              pNModel.platform
            )
            switch (response?.code) {
              case 0:
                await transaction.commit()
                transaction = undefined
                this.logger.log(` [x] Push notification enviado com sucesso`)
                channel.ack(message)
                return true
              case 1:
                this.logger.warn(` [x] Push notification não foi enviado, token não foi localizado`)
                await transaction.commit()
                transaction = undefined
                await pNModel.destroy()
                channel.ack(message)
                return true
              case -1:
                if (i < 3) {
                  n += i
                  await Utils.System.sleep(n * 2000)
                }
                break
              default:
                await transaction.commit()
                transaction = undefined
                channel.ack(message)
                return false
            }
            await transaction.rollback()
            transaction = undefined
          } while (i < 4)
          this.logger.error(
            `[x] o email não foi enviado após ${i} tentativas em ${(startTime - new Date().getTime()) / 1000}s.`
          )
        }
      } else {
        this.logger.log(` [Erro]: O metodo: ${payload?.method} não suportado!`)
        channel.ack(message)
        return false
      }
    } catch (error: any) {
      channel.nack(message)
      this.logger.error(error)
    }
    channel.ack(message)
    return false
  }

  async sendPushNotificationByToken(
    model: DBModels.PNMessageModel,
    message: Types.Classes.CNotificationPayload,
    transaction?: Domain.SqlDB.Transaction,
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
        await model.save({ transaction })
      }
    } catch (error: any) {
      this.logger.log('sendPushNotificationByToken:', message.toJSON())
      this.logger.error(error)
    }
    return response
  }
}

await new PushNotificationWorker().run()
