---
layout: post
title: "Preventing Kafka broker scale down if partition replicas are present"
date: 2023-12-11
author: Shubham Rawat
---

Apache Kafka is a platform designed for scalability.
You can always scale in or scale out your Kafka Clusters based on your use case.
When scaling down a cluster, it's crucial to ensure that data across brokers is moved or copied throughout the cluster.
You may experience data loss if you forget to move out partition replicas from the broker being removed.
But don't worry, with Strimzi 0.38, we have introduced the broker scale down check which is going to take care of this problem.

## Broker scale down check

This check makes sure that, when you are scaling down your Kafka cluster, there are no partition replicas present on the broker that is going to be removed.
If partition replicas are found on the broker then the cluster operations are blocked and reconciliation fails until you revert the Kafka resource.
This is enabled by default with Strimzi 0.38.

However, there may be scenarios where you want to bypass this blocking mechanism.
For example, disabling the check might be necessary when new topics are being constantly created.
This situation can indefinitely block cluster operations, even when brokers are nearly empty.

You can bypass the blocking mechanism by annotating the `Kafka` resource for the Kafka cluster by setting the `strimzi.io/skip-broker-scaledown-check` annotation to `true`:
```shell
kubectl annotate Kafka my-cluster strimzi.io/skip-broker-scaledown-check="true"
```

## Setting up the environment

Let's set up a cluster to work through an example demonstrating this feature.

To get the Kafka cluster up and running, we will first have to install the Strimzi Cluster Operator and then deploy the `Kafka` resource.
You can refer to the [Stimzi Quickstart Guide](https://strimzi.io/docs/operators/latest/quickstart.html) to install the operator.

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
    replicas: 3
    storage:
      type: ephemeral
  entityOperator:
    topicOperator: {}
    userOperator: {}
  cruiseControl: {}
```

Once the cluster is up, we can create some topics such that we have some partition replicas assigned to the brokers.
This is a topic configuration example:
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

You can now check how topic partition replicas are allocated across the brokers using the command:
```shell
$ kubectl run -n myproject client -itq --rm --restart="Never" --image="quay.io/strimzi/kafka:latest-kafka-3.6.0" -- \
sh -c "/opt/kafka/bin/kafka-topics.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --describe --topic my-topic; exit 0";

Topic: my-topic	TopicId: bbX7RyTSSXmheaxSPyRIVw	PartitionCount: 3	ReplicationFactor: 3	Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
	Topic: my-topic	Partition: 0	Leader: 2	Replicas: 2,3,1	Isr: 2,3,1
	Topic: my-topic	Partition: 1	Leader: 3	Replicas: 3,1,0	Isr: 3,1,0
	Topic: my-topic	Partition: 2	Leader: 1	Replicas: 1,0,2	Isr: 1,0,2
```

### Scaling down without moving out all replicas from the broker to be removed

Let's try to scale down the number of brokers by changing the `.spec.kafka.replicas` configuration from 4 to 3, while all brokers have partition replicas assigned.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    version: 3.6.0
    replicas: 3 # Changes the replicas to 3
    listeners:
# ....    
```

Now you can apply the updated Kafka custom resource and check if the brokers are scaled down or not.

You check the status of the Kafka custom resource using this command:
```sh
kubectl get kafka my-cluster -n myproject -o yaml
```

Since we didn't move the replicas from the broker to be removed, the scale down fails and, as indicated by the errors given in the status of the Kafka custom resource:
```yaml
status:
  clusterId: S4kUmhqvTQegHCGXPrHe_A
  conditions:
  - lastTransitionTime: "2023-12-04T07:03:49.161878138Z"
    message: Cannot scale down brokers [3] because brokers [3] are not empty
    reason: InvalidResourceException
    status: "True"
    type: NotReady
```
So these logs are basically telling you that broker 3 is not empty, which makes the whole reconciliation fail. You can get rid of this error by reverting `.spec.kafka.replicas` in the Kafka resource.

### Scaling down after moving out all replicas from the broker to be removed

Now, let's first move out all replicas from the broker to be removed, before attempting a new Kafka cluster scale down.

We can make use of Cruise Control's `KafkaRebalance` resource in Strimzi with `remove-broker` node configuration for this job.
Here is an example `KafkaRebalance` resource:
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaRebalance
metadata:
  name: my-rebalance
  labels:
    strimzi.io/cluster: my-cluster
# no goals specified, using the default goals from the Cruise Control configuration
spec:
  mode: remove-brokers
  brokers: [3]
```
You can create this `KafkaRebalance` custom resource that triggers a Cruise Control rebalancing execution that moves out all partition replicas from the broker that is going to be removed.
Note that this execution may take some time, depending on partitions' size.
For more in-depth information you can refer to our [Rebalancing cluster using Cruise Control](https://strimzi.io/docs/operators/latest/deploying#proc-generating-optimization-proposals-str) documentation.

Once the rebalacing is done, you can check if the topics are moved from the broker or not:
```shell
Topic: my-topic	TopicId: bbX7RyTSSXmheaxSPyRIVw	PartitionCount: 3	ReplicationFactor: 3	Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
	Topic: my-topic	Partition: 0	Leader: 2	Replicas: 2,0,1	Isr: 2,1,0
	Topic: my-topic	Partition: 1	Leader: 2	Replicas: 2,1,0	Isr: 1,0,2
	Topic: my-topic	Partition: 2	Leader: 1	Replicas: 1,0,2	Isr: 1,0,2
```

Now you can scale down the broker, and it will happen seamlessly since the broker is empty.

## What's next

We hope this blog post has provided you with a clear understanding of how the broker scale-down check operates.
In upcoming Strimzi releases, we aim to enhance this process by continuing the reconciliation without doing the scaledown in case partition replicas are found on the broker that is going to be removed.
This improvement will ensure that reconciliation doesn't fail, and cluster operations remain unblocked.