---
layout: post
title:  "Auto-restarting connectors in Apache Kafka Connect and Mirror Maker 2"
date: 2023-01-22
author: jakub_scholz
---

Apache Kafka Connect provides a framework for integrating Apache Kafka with external systems using connectors.
Connectors run inside the Kafka Connect deployment, connect to the external system, and help to push data from Kafka to the external system or the other way around.
When running Kafka Connect, you have to monitor not only the state of the Kafka Connect deployment, but also the state of the connectors and their tasks.
If a connector or one of its tasks fail, you check the reason it failed so you know how to fix it.
In many cases, the issue is something temporary like a network glitch or an outage of the external system.
And all you need to do to fix it is just restart the connector or task.
Could this be something the operator might do for you?

<!--more-->

Having the operator automatically restart failed connectors or their tasks was one of the most common feature requests received by Strimzi.
And in Strimzi 0.33, this feature was contributed by [Thomas Dangleterre](https://github.com/ThomasDangleterre).
So, how does it work?

The auto-restart feature is supported only when using the _connector operator_ and the `KafkaConnector` custom resources to manage the connectors.
It is disabled by default.
You can enable it using the `.spec.autoRestart` property of the `KafkaConnector` resource:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnector
metadata:
  name: my-connector
spec:
  # ...
  autoRestart:
    enabled: true
  # ...
```

When enabled, the Strimzi Cluster Operator watches the connector and its tasks for failures in every reconciliation.
And if it sees that any of them have failed, it automatically restarts them.

Not every error can be solved by a restart.
If the connector or its task failed by some temporary problem such as the network issue mentioned earlier, a restart is an obvious solution.
But if it is failing because it does not understand the protocol of the remote system or has the wrong credentials, then a restart will not help.
In these cases, we do not want to keep restarting the connectors forever.

That is why the operator will always restart the connector or its task only up to 7 times.
The restarts will happen always after an increasing time period.
The first restart will happen immediately.
If it does not help, the next restart will happen only after another 2 minutes.
If even the second restart doesn't help, the next restart will be done only after another 6 minutes.
And so on.
This leaves more time for the root cause of the failure to be resolved. 
Thanks to this back-off mechanism, even if the network outage takes over 10 minutes, the auto-restart will help your connectors to recover from it.
But if the issue is not resolved even after the 7th restart, the operator will stop restarting and it is up to you to solve it manually.

You can track the restarting progress in the `.status` section of the `KafkaConnector` resource:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnector
metadata:
  name: my-connector
spec:
  # ...
status:
  # ...
  autoRestart:
    count: 1
    lastRestartTimestamp: "2023-01-22T21:38:24.402461310Z"
```

If the connector recovers and keeps running, the counter of the restarts is reset as well.
And when the next issue happens - possibly days or weeks later - it will start again from 0.

### Example

Let's have a look at how it works in an example.
First, you have to install Strimzi 0.33.0 or newer and deploy a Kafka cluster.
In my case, I used to simplest possible cluster based on our examples:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    version: 3.3.2
    replicas: 3
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: tls
        port: 9093
        type: internal
        tls: true
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
      default.replication.factor: 3
      min.insync.replicas: 2
      inter.broker.protocol.version: "3.3"
    storage:
      type: jbod
      volumes:
      - id: 0
        type: persistent-claim
        size: 100Gi
        deleteClaim: false
  zookeeper:
    replicas: 3
    storage:
      type: persistent-claim
      size: 100Gi
      deleteClaim: false
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

Next, we create a topic that we will use:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: my-topic
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 3
  replicas: 3
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
```

Then, we have to deploy the Kafka Connect cluster.
It enables the connector operator with the `strimzi.io/use-connector-resources` annotation.
And it adds a custom [Echo Sink connector](https://github.com/scholzj/echo-sink) to the deployment.
The Echo Sink connector is my _test_ connector which gets the messages from Kafka Connect, but instead of sending them to some external system, it simply logs them to the standard output.
It has also a special option `fail.task.after.records` which makes the connector tasks fail after receiving a pre-configured amount of messages.
And we will use this feature to demonstrate the auto-restart feature.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnect
metadata:
  name: my-connect
  annotations:
    strimzi.io/use-connector-resources: "true"
spec:
  version: 3.3.2
  replicas: 1
  bootstrapServers: my-cluster-kafka-bootstrap:9092
  config:
    group.id: connect-cluster
    offset.storage.topic: connect-cluster-offsets
    config.storage.topic: connect-cluster-configs
    status.storage.topic: connect-cluster-status
    # -1 means it will use the default replication factor configured in the broker
    config.storage.replication.factor: -1
    offset.storage.replication.factor: -1
    status.storage.replication.factor: -1
  build:
    output:
      type: docker
      image: ttl.sh/auto-restart-blog-post:latest
    plugins:
      - name: echo-sink-connector
        artifacts:
          - type: jar
            url: https://github.com/scholzj/echo-sink/releases/download/1.3.0/echo-sink-1.3.0.jar
            sha512sum: 7a32ab28734e4e489a2f946e379ad4266e81689d1ae1a54b6cd484ca54174eb52f271ed683f62e2fd838f48d69a847c11a6dbb4d31bf9fc5b7edd6f5463cd0b5
```

When the Kafka Connect cluster is running, we create the connector.
Notice, that it enabled the auto-restart feature and configures the connector to have its task fail after receiving 6 messages.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnector
metadata:
  name: echo-sink
  labels:
    strimzi.io/cluster: my-connect
spec:
  class: EchoSink
  tasksMax: 1
  autoRestart:
    enabled: true
  config:
    topics: "my-topic"
    fail.task.after.records: 5
    key.converter: org.apache.kafka.connect.storage.StringConverter
    value.converter: org.apache.kafka.connect.storage.StringConverter
    key.converter.schemas.enable: false
    value.converter.schemas.enable: false
```

After we create the connector, it creates the task and runs without any issues because it is not receiving any messages yet.
So we have to start a producer and send the first 6 messages.

```
kubectl run kafka-producer -ti --image=quay.io/strimzi/kafka:0.33.0-kafka-3.3.2 --rm=true --restart=Never -- bin/kafka-console-producer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic
If you don't see a command prompt, try pressing enter.
>Hello World 1
>Hello World 2
>Hello World 3
>Hello World 4
>Hello World 5
>Hello World 6
```

After the sixth message, the following error shows in the Kafka Connect log:

```
2023-01-22 23:02:52,246 WARN [echo-sink|task-0] Failing as requested after 5 records (cz.scholz.kafka.connect.echosink.EchoSinkTask) [task-thread-echo-sink-0]
2023-01-22 23:02:52,246 ERROR [echo-sink|task-0] WorkerSinkTask{id=echo-sink-0} Task threw an uncaught and unrecoverable exception. Task is being killed and will not recover until manually restarted. Error: Intentional task failure after receiving 5 records. (org.apache.kafka.connect.runtime.WorkerSinkTask) [task-thread-echo-sink-0]
java.lang.RuntimeException: Intentional task failure after receiving 5 records.
	at cz.scholz.kafka.connect.echosink.EchoSinkTask.put(EchoSinkTask.java:131)
	at org.apache.kafka.connect.runtime.WorkerSinkTask.deliverMessages(WorkerSinkTask.java:581)
	at org.apache.kafka.connect.runtime.WorkerSinkTask.poll(WorkerSinkTask.java:333)
	at org.apache.kafka.connect.runtime.WorkerSinkTask.iteration(WorkerSinkTask.java:234)
	at org.apache.kafka.connect.runtime.WorkerSinkTask.execute(WorkerSinkTask.java:203)
	at org.apache.kafka.connect.runtime.WorkerTask.doRun(WorkerTask.java:189)
	at org.apache.kafka.connect.runtime.WorkerTask.run(WorkerTask.java:244)
	at java.base/java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:539)
	at java.base/java.util.concurrent.FutureTask.run(FutureTask.java:264)
	at java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)
	at java.base/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:635)
	at java.base/java.lang.Thread.run(Thread.java:833)
2023-01-22 23:02:52,249 ERROR [echo-sink|task-0] WorkerSinkTask{id=echo-sink-0} Task threw an uncaught and unrecoverable exception. Task is being killed and will not recover until manually restarted (org.apache.kafka.connect.runtime.WorkerTask) [task-thread-echo-sink-0]
org.apache.kafka.connect.errors.ConnectException: Exiting WorkerSinkTask due to unrecoverable exception.
	at org.apache.kafka.connect.runtime.WorkerSinkTask.deliverMessages(WorkerSinkTask.java:611)
	at org.apache.kafka.connect.runtime.WorkerSinkTask.poll(WorkerSinkTask.java:333)
	at org.apache.kafka.connect.runtime.WorkerSinkTask.iteration(WorkerSinkTask.java:234)
	at org.apache.kafka.connect.runtime.WorkerSinkTask.execute(WorkerSinkTask.java:203)
	at org.apache.kafka.connect.runtime.WorkerTask.doRun(WorkerTask.java:189)
	at org.apache.kafka.connect.runtime.WorkerTask.run(WorkerTask.java:244)
	at java.base/java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:539)
	at java.base/java.util.concurrent.FutureTask.run(FutureTask.java:264)
	at java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)
	at java.base/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:635)
	at java.base/java.lang.Thread.run(Thread.java:833)
Caused by: java.lang.RuntimeException: Intentional task failure after receiving 5 records.
	at cz.scholz.kafka.connect.echosink.EchoSinkTask.put(EchoSinkTask.java:131)
	at org.apache.kafka.connect.runtime.WorkerSinkTask.deliverMessages(WorkerSinkTask.java:581)
	... 10 more
```

And the task fails.
In the next reconciliation, the operator restarts the task.
You can see this in the operator log:

```
2023-01-22 23:04:24 INFO  AbstractOperator:239 - Reconciliation #73(timer) KafkaConnect(myproject/my-connect): KafkaConnect my-connect will be checked for creation or modification
2023-01-22 23:04:24 INFO  AbstractConnectOperator:502 - Reconciliation #73(timer) KafkaConnect(myproject/my-connect): creating/updating connector: echo-sink
2023-01-22 23:04:24 INFO  AbstractConnectOperator:692 - Reconciliation #73(timer) KafkaConnect(myproject/my-connect): Auto restarting connector echo-sink
2023-01-22 23:04:24 INFO  AbstractConnectOperator:696 - Reconciliation #73(timer) KafkaConnect(myproject/my-connect): Restarted connector echo-sink
2023-01-22 23:04:24 INFO  CrdOperator:133 - Reconciliation #73(timer) KafkaConnect(myproject/my-connect): Status of KafkaConnector echo-sink in namespace myproject has been updated
2023-01-22 23:04:24 INFO  AbstractOperator:510 - Reconciliation #73(timer) KafkaConnect(myproject/my-connect): reconciled
```

And you can see the status of the `KafkaConnector` resource updated as well:

```yaml
# ...
status:
  # ...
  autoRestart:
    count: 1
    lastRestartTimestamp: "2023-01-22T23:04:24.386944356Z"
```

If you want, you can send another batch of messages to see it fail again, and check that with every restart the restart counter increases and takes longer before the next restart happens.
Or you can stop sending messages.
In that case, the connector and its task keeps running and the auto-restart counter eventually resets to 0 again.
The reset of the auto-restart counter is logged in the operator logs as well:

```
2023-01-22 23:26:24 INFO  AbstractConnectOperator:660 - Reconciliation #100(timer) KafkaConnect(myproject/my-connect): Resetting the auto-restart status of connector echo-sink
```

### MirrorMaker 2

So far, we've only talked about Kafka Connect.
Strimzi runs Kafka MirrorMaker 2 on top of Kafka Connect.
So you can actually use the same mechanism to restart MirrorMaker 2 connectors too.
The only difference is that you configure it in the `KafkaMirrorMaker2` custom resource:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaMirrorMaker2
metadata:
  name: my-mm2-cluster
spec:
  mirrors:
  - sourceConnector:
      autoRestart:
        enabled: true
      # ...
    heartbeatConnector:
      autoRestart:
        enabled: true
      # ...
    checkpointConnector:
      autoRestart:
        enabled: true
      # ...
```

### Conclusion

There are many situations where the connector auto-restarting will not help and an admin will need to jump in, figure out the problem, and resolve the issues.
But even if it helps only in some situations, it is still a great addition to Strimzi which should make your life easier.

Having it contributed by a user also shows the value of the Strimzi community.
If you have some feature you are missing in Strimzi, we are always open to contributions.
It is not always easy as we need to make sure that the added features can be maintained, tested, and follow the right direction.
But it is one of the ways you can help make Strimzi even better.
If you want to start, the best way is to read the [_Join Us_ page](https://strimzi.io/join-us/) on our website or [get in touch with us](https://github.com/strimzi/strimzi-kafka-operator#getting-help) on Slack, our mailing list, or GitHub Discussions.

Thanks a lot to Thomas for this great contribution!
And of course many thanks to all the other contributors as well.