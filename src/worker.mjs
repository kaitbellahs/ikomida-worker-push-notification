#!/usr/bin/env node

import {
    RabbitMQ,
    SqlDB,
    GoogleAdmin,
    Logger
} from 'ikomida-shared';
import {
    createRequire
} from "module";
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

    googleAdmin;
    amqp;
    logger

    constructor() {
        this.logger = Logger.getInstance(name, process.env?.ENV !== 'PROD')
    }

    async run() {
        try {
            this.googleAdmin = new GoogleAdmin()
            this.amqp = new RabbitMQ(this.logger)
            await this.amqp.listenToMessages(RabbitMQ.PUSH_NOTIFICATION_SEVERITY, this.processMessages.bind(this))
        } catch (error) {
            this.logger.error(error)
        }
    }

    async processMessages(message, channel) {
        try {
            this.logger.log(` [x] ${message.fields.routingKey}: message received: '${message.content.toString('utf8')}'`)
            const messageObject = JSON.parse(message.content.toString('utf8'))
            if (messageObject.method === 'send') {
                const contractModel = await SqlDB.ContractModel.findOne({
                    where: {
                        id: messageObject.object.contractId
                    }
                })

                if (!contractModel) {
                    return false;
                }
                let pushNotificationModel
                if (messageObject.object.userId) {
                    const userModels = await contractModel.getUsers({
                        where: {
                            id: messageObject.object.userId
                        }
                    })

                    if (userModels.length !== 1) {
                        return false;
                    }
                    const userModel = userModels[0];
                    pushNotificationModel = await userModel.getPushNotificationModel()
                } else {
                    const pushNotificationModels = await contractModel.getPushNotifications({
                        where: {
                            role: Roles.VENDOR
                        }
                    })
                    if ((pushNotificationModels?.length ?? 0) === 1) {
                        pushNotificationModel = pushNotificationModels[0];
                    }
                }
                const pushNotificationMessageModel = await pushNotificationModel.createPushNotificationMessage({
                    title: message?.notification?.title,
                    body: message?.notification?.body,
                    data: JSON.stringify(message?.data)
                })

                await pushNotificationMessageModel.setContract(contractModel)

                if (messageObject.object.userId) {
                    await pushNotificationMessageModel.setUser(userModel)
                }

                for (let i = 1; i < 4; i++) {
                    if (this.sendPushNotificationByToken(pushNotificationMessageModel, messageObject.object.message)) {
                        break;
                    }
                    await this.sleep(i * 1000)
                }

            }
        } catch (error) {
            this.logger.error(error)
        } finally {
            channel.ack(message)
        }
    }

    async sendPushNotificationByToken(model, message) {

        const response = await this.googleAdmin.sendPushNotification(message)
        if (!response) {
            return false;
        }
        model.remoteId = response;
        model.send = true;
        model.save()

        return true;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

await (new PushNotificationWorker).run()