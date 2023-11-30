---
layout: post
title: "Prevent broker scale down if containing partition replicas""
date: 2023-11-30
author: Shubham Rawat
---
Apache Kafka is a platform which is designed to be scalable.
You can always scale in or scale out your Kafka Clusters based on your use case.
When dealing with scaling down of cluster, you have to make sure that data across the brokers are moved/copied across the cluster.
There can be a possibility that while scaling down, you forgot to remove the partition replicas from the broker that is going to be removed and due to that you will have to suffer data loss.
But don't worry, with Strimzi 0.38, we have introduced the broker scale down check which is going to take care of this problem.

## Broker scale down check

This check makes sure that when you are scaling down your cluster, there are no partition replicas present on the broker that is going to be removed.
If partition replicas are found on the broker then the cluster operations are blocked and reconciliation fails until you revert the Kafka resource.
The check is enabled by default with Strimzi 0.38.

However, there may be scenarios where you want to bypass this blocking mechanism.
Disabling the check might be necessary on busy clusters, for example, because new topics keep generating replicas for the broker. .
This situation can indefinitely block cluster operations, even when brokers are nearly empty.
Overriding the blocking mechanism in this way has an impact:
the presence of topics on the broker being scaled down will likely cause a reconciliation failure for the Kafka cluster.

You can bypass the blocking mechanism by annotating the `Kafka` resource for the Kafka cluster by setting the `strimzi.io/skip-broker-scaledown-check` annotation to `true`:
```shell
kubectl annotate Kafka my-kafka-cluster strimzi.io/skip-broker-scaledown-check="true"
```

## Setting up the environment

Let's spin up an cluster where we can work through some reassignment examples.

To get the Kafka cluster up and running, we will first have to install the Strimzi Cluster Operator and then deploy the `Kafka` resource.
You can refer to the [Stimzi Quickstart Guide](https://strimzi.io/docs/operators/latest/quickstart.html) for installing Strimzi.

You can install the Cluster Operator with any installation method you prefer.

Then we will deploy the Kafka cluster with Cruise Control enabled.

Example Kafka resource with Cruise Control enabled:
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    version: 3.6.0
    replicas: 4
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
      inter.broker.protocol.version: "3.6"
    storage:
      type: ephemeral
  zookeeper:
    replicas: 4
    storage:
      type: ephemeral
  entityOperator:
    topicOperator: {}
    userOperator: {}
  cruiseControl: {}
```

Once the cluster is up, we can create some topics such that we have some partition replicas asssigned to the brokers
Here is an exmaple topic configuration:
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

You can now check how topic partition replicas are allocated across the brokers:
```shell
Topic: my-topic	TopicId: VcdsMY9gR1STjURMGEHrlA	PartitionCount: 3	ReplicationFactor: 3	Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
	Topic: my-topic	Partition: 0	Leader: 1	Replicas: 1,0,2	Isr: 1,0,2
	Topic: my-topic	Partition: 1	Leader: 0	Replicas: 0,2,3	Isr: 0,2,3
	Topic: my-topic	Partition: 2	Leader: 2	Replicas: 2,3,1	Isr: 2,3,1
```

### Scaling down the replicas (without moving replicas from broker to be removed)

Let's try to scale down the no. of brokers from 4 to 3 while all brokers are currently having partition replicas assigned to them

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    version: 3.6.0
    replicas: 3            // Changes the replicas to 3
    listeners:
# ....    
```

Now you can apply the updated Kafka custom resource and check if the broker are scaled down or not.

You check the logs using this command:
```sh
kubect logs kubectl logs strimzi-cluster-operator-56fb857f7c-9hq6l -n myproject 
```

Since we didn't move the replicas from the broker to be removed, the scale down will fail and, you will be able to see these errors in the logs
```shell
2023-11-30 11:08:12 WARN  AbstractOperator:557 - Reconciliation #150(watch) Kafka(myproject/my-cluster): Failed to reconcile
io.strimzi.operator.common.model.InvalidResourceException: Cannot scale down brokers [3] because brokers [3] are not empty
	at io.strimzi.operator.cluster.operator.assembly.KafkaReconciler.lambda$brokerScaleDownCheck$26(KafkaReconciler.java:300) ~[io.strimzi.cluster-operator-0.38.0.jar:0.38.0]
	at io.vertx.core.impl.future.Composition.onSuccess(Composition.java:38) ~[io.vertx.vertx-core-4.4.6.jar:4.4.6]
	at io.vertx.core.impl.future.FutureBase.emitSuccess(FutureBase.java:60) ~[io.vertx.vertx-core-4.4.6.jar:4.4.6]
	at io.vertx.core.impl.future.FutureImpl.tryComplete(FutureImpl.java:211) ~[io.vertx.vertx-core-4.4.6.jar:4.4.6]
	at io.vertx.core.impl.future.PromiseImpl.tryComplete(PromiseImpl.java:23) ~[io.vertx.vertx-core-4.4.6.jar:4.4.6]
	at io.vertx.core.Promise.complete(Promise.java:66) ~[io.vertx.vertx-core-4.4.6.jar:4.4.6]
```
So these logs are basically telling you that the broker are not empty and therefore the reconciliation is failing and cluster operations are blocked. To get rid of this error you can revert the replica change in the Kafka resource.

### Scaling down the replicas (after emptying partition replicas from broker to be removed)

Let's try to scale down the broker now after emptying partition replicas from the broker to be removed.
We can make use of the `KafkaRebalance` resource in Strimzi with `remove-broker` node configuration for this job. 
Doing this will make Cruise Control do all the job of rebalancing and moving the partition replicas form the broker that is going to be removed.

Once the rebalacing is done, you can validate/check if the topics are move from broker or not.
```shell
	Topic: my-topic	Partition: 0	Leader: 1	Replicas: 1,0,2	Isr: 1,0,2
	Topic: my-topic	Partition: 1	Leader: 0	Replicas: 0,2,1	Isr: 0,2,1
	Topic: my-topic	Partition: 2	Leader: 2	Replicas: 2,0,1	Isr: 2,1,0
```

Now you can scale down the broker and, it will happen flawlessly since the broker is empty.

## What's next

Hope this blog post gave you a gist on how broker scale down check works.
With the next releases of Strimzi, we are working to make this process more flawless by reverting the kafka replicas back to what they were if the broker scale dowm check fails so that the reconciliation doesn't fail and there is no blocking of cluster operations