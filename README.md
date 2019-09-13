# Deplay messages for AMQP-0-9-1

Usecase: I want send/process a AMQP0-9-1 message at x time

This application lets you send a message to another queue or process a message for self with delays. There is no limit on amount of delay time.

## Existing solutions and their limitations

1. If you are using RabbitMQ, you can use [rabbitmq_delayed_message_exchange](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange) but its limitation is that only one copy of scheduled message kept in the cluster which means that "losing that node or disabling the plugin on it will lose the messages residing on that node".

2. If you are using [AWS SQS](https://aws.amazon.com/sqs/) then it supports maximum delay of [15 minutes](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html)

This application tries to solve the above pain points

## Getting started

```bash
npm install
export DELAY_QUEUE_NAME=delay-queue
export AMQP_CONNECTION_STRING=amqp://localhost
npm start
```

Now to start making use of it, producers wanting to send a message to consumer queue with delay, should send that message to `delay-queue` in following format:

```javascript
{"expireAt":1568402666, "replyQueueName":"consumer", "payload":"Hello world"}
```

expireAt is a unix timestamp at which the application will deliver the message "Hello World" to `consumer` queue. The delivery time is followed at best effort. The only guarantee is that the message will not be delivered sooner than the declared `expireAt` timestamp.

## How it works internally

It builds on top message acknowledgement feature of message brokers. Producers wanting to send a message to another queue with some delay lets say 2 hours from now, send a message to this applications message queue. Following is an example message.

```json
{
    "expireAt": 1568405771, // unix timestamp of after 2hrs
    "replyQueueName": "consumer",
    "payload": "your message"
}
```

This message is picked by this application, set's an internal timeout equal to time left for delay expiration. When the internal timer timesout, the message payload is delivered to queue mentioned in `replyQueueName`.

### Fault tolerance and high availabiliy
You can run multiple replicas of this application. The messages sent by producers are `acked` and removed from the application's queue only when the message has been delivered to `replyQueueName`. If the replica crashes before delivering the message to `replyQueueName`, rabbitmq will reenqueue the message and some other relica will pick it up and repeat the delay logic till its delivered to `replyQueueName`
