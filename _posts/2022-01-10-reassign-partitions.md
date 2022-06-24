---
layout: post
title:  "Reassigning partitions in Apache Kafka Cluster"
date: 2021-09-23
author: shubham_rawat
---

To optimize the operation of your Kafka cluster, you can change the assignment of partitions to brokers.
Sometimes you might want to move the partitions from one broker to another or maybe you want to change the ordering of partition assignment list.
Cruise Control can be used to tackle these issues easily.
However, if you don't want to use Cruise Control and prefer to do the reassignment manually, then you can use the Kafka partition reassignment tool.
Here is a guide on how you can use it.

<!--more-->

##  Kafka reassignment partition tool

The `bin/kafka-reassign-partitions.sh` tool allows you to reassign partitions to different brokers.

When using the tool you have to provide it with either of these two JSON files: `topics.json` or `reassignment.json`.

- The `topics.json` basically consists of the topics that we want to reassign or move. Based on this JSON file, the reassignment script will generate a proposal (`reassignment.json`) that we can use directly or modify further.

- The `reassignment.json` file is a configuration file that is used during the partition reassignment process. The reassignment partition tool will generate a proposal `reassignment.json` file based on a `topics.json` file. You can change the `reassignment.json` file as per your requirement and use it.

## Why use the Kafka reassignment partition tool?

The Kafka reassignment partition tool can help you address a variety of use cases.

Some of these are listed here:

- You can reassign partitions between the brokers. For example, it can be used when you want to scale down the number of brokers in your cluster.
   You can assign partitions from the broker to be scaled down to other brokers which will handle these partitions now.

- You can change the ordering of partition assignment list. It can be used to control leader imbalances between brokers.


## Partition Reassignment Throttle
Reassigning partitions between brokers often leads to additional inter-broker network traffic, in addition to the normal traffic required for replication.
To avoid overloading the cluster, it is recommended to always set a throttle rate to limit the bandwidth used by the reassignment.
This can be done using the `--throttle` flag which sets the maximum allowed bandwidth in bytes per second, for example `--throttle 5000000` sets the limit to 5 MB/s.

Throttling might cause the reassignment to take longer to complete.

1. If the throttle is too low, the newly assigned brokers will not be able to keep up with records being published and the reassignment will never complete.

2. If the throttle is too high, the overall health of the cluster may be impacted.

You can use the `kafka.server:type=FetcherLagMetrics,name=ConsumerLag,clientId=([-.\w]+),topic=([-.\w]+),partition=([0-9]+)` metric (which with the spec.kafka.metrics settings in your Kafka CR would appear be scraped by Prometheus as `kafka_server-fetcherlagmetrics_consumerlag`) to observe how far the followers are lagging behind the leader. You can also refer to this [example](https://github.com/strimzi/strimzi-kafka-operator/blob/main/packaging/examples/metrics/kafka-metrics.yaml) for configuring metrics 

The best way to set the value for throttle is to start with a safe value.
If the lag is growing, or decreasing too slowly to catch up within a reasonable time, then the throttle should be increased.
To do this, run the command again to increase the throttle, iterating until it looks like the broker will join the ISR within a reasonable time.

## Actions that can be executed while using the tool

The partition reassignment tool has three different actions:

| Action | Description |
| :-----------: | ------------- |
| `generate`  | Takes a set of topics and brokers and generates a reassignment JSON file. This action is optional if we already have `reassignment.json` file with us. You can use this action by using the `--generate` flag|
| `execute` | Takes a reassignment JSON file and applies it to the partitions and brokers in the cluster. The `reassignment.json` file can be either the one proposed by the `generate` action or written by the user. The `--execute` flag  is used to carry out this action. |
| `verify`  | Using the same reassignment JSON file as the `--execute` step, `--verify` checks whether all the partitions in the file have been moved to their intended brokers. If the reassignment is complete, `--verify` also removes any replication quotas (`--throttle`) that are in effect. Unless removed, throttles will continue to affect the cluster even after the reassignment has finished. This action can be executed using `--verify` flag. |

## Example

Let us understand the working of this tool with an example.
Suppose we have 5 Kafka Brokers and after looking at the partition details we realize that the brokers are not too busy, so we can scale them down to 3. 
Now to scale down the brokers, one easy way is to use Cruise Control for it. You can use create a `KafkaRebalance` resource with `spec.mode` field set as `remove-broker` and list the broker you want to remove,
After that you can approve the proposal which is generated by Cruise control for you and once the rebalancing is finished you can scale down the brokers.
The other way possible is to use this tool to do the job.
Through this example we will take a look at how the three actions of the Kafka reassignment partition tool(`--generate`, `--execute` and `--verify`) work.
We will generate the JSON data that will be used in the `reassignment.json` file.
We will then assign the partitions to the remaining broker using the `reassignment.json` file.

Before proceeding with the steps above, let's address an important issue. Can you scale down any pod you want through this process?
The answer to this question is no.
This is due to the fact Strimzi uses StatefulSets to manages broker pods.
The Kubernetes StatefulSet controller managed pods with contiguous numbers starting from 0.
So when scaling down it will always remove the the highest numbered pod(s).
For example, in a cluster of 5 brokers the pods are named `my-cluster-kafka-0` up to `my-cluster-kafka-4`.
If you decide to scale down by two brokers, then `my-cluster-kafka-4` and `my-cluster-kafka-3` will be removed.

 The next section will help you set up the environment for executing the above example, i.e. setting up your kafka cluster, kafka topics and also configuring the Kafka user with required ACL's.

Note: In case you already have the environment set up, you can skip the next section.

### Setting up the environment

To get the Kafka cluster up and running, we will first have to install the Strimzi Cluster Operator and then deploy the Kafka resource. You can refer to the [Stimzi Quickstart Guide](https://strimzi.io/docs/operators/latest/quickstart.html) for installing Strimzi.

You can install the Cluster Operator with any installation method you prefer.
The Kafka cluster is then deployed with the plain listener enabled on port 9092.

Example Kafka configuration with plain listener.
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
   name: my-cluster
spec:
   kafka:
      version: 3.2.0
      replicas: 5
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
         inter.broker.protocol.version: "3.2"
      storage:
         type: ephemeral
   zookeeper:
      replicas: 3
      storage:
         type: ephemeral
   entityOperator:
      topicOperator: {}
      userOperator: {}
```

Once the cluster is running, let's deploy some topics where we will send and receive the messages.
Here is an example topic configuration. You can change it to suit your requirements.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: my-topic-two
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 10
  replicas: 3
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
    # ...
```

### Creating a proposal `reassignment.json` file

When you have a Kafka cluster running with brokers and topics, you are ready to create the proposal JSON file.

Let us create a separate interactive pod.
This interactive pod is used to run all the reassignment commands.
You may ask why we are using a separate pod to run the commands? Can't we just use one of the broker pods? 
The issue is that running commands from within a broker is not good practice.
Running any of the Kafka `/bin` scripts from within the broker container will start another JVM (with all the same settings as the Kafka broker).
This can cause disruption, including causing the container to run out of memory.
So it is always better to avoid running the commands from a broker pod.

So now it's time to get our interactive pod up and running. You can use the following command:

```sh
kubectl run --restart=Never --image=quay.io/strimzi/kafka:0.29.0-kafka-3.2.0 my-pod -- /bin/sh -c "sleep 3600"
```

Wait till the pod gets into the `Ready` state.
Once it is ready, our next step will be to see which topics needs reassignment.

As we discussed above, this file will have the topics that we need to reassign.

Now a good question arises. What topics require reassignment?
The answer to this is the topics that have their partitions assigned to broker `<CLUSTER-NAME>-kafka-3` and `<CLUSTER-NAME>-kafka-4` need reassignment, these topics partition should move to the remaining 3 brokers nodes in our cluster.

To check the partitions details of a certain topic, we can use the `kafka-topics.sh` tool. We can run the following command from inside interactive pod after starting a shell process using `kubectl exec -ti <INTERACTIVE-POD-NAME> /bin/bash`
:

```sh
bin/kafka-topics.sh --describe --topic my-topic-two --bootstrap-server my-cluster-kafka-bootstrap:9092
```
which will give us the following output:

```shell
Topic: my-topic-two     TopicId: RBVQ5cTgRSK4TNnGXZFkKw PartitionCount: 10      ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
       Topic: my-topic-two     Partition: 0    Leader: 0       Replicas: 0,4,1 Isr: 0,4,1
       Topic: my-topic-two     Partition: 1    Leader: 4       Replicas: 4,1,2 Isr: 4,1,2
       Topic: my-topic-two     Partition: 2    Leader: 1       Replicas: 1,2,3 Isr: 1,2,3
       Topic: my-topic-two     Partition: 3    Leader: 2       Replicas: 2,3,0 Isr: 2,3,0
       Topic: my-topic-two     Partition: 4    Leader: 3       Replicas: 3,0,4 Isr: 3,0,4
       Topic: my-topic-two     Partition: 5    Leader: 0       Replicas: 0,1,2 Isr: 0,1,2
       Topic: my-topic-two     Partition: 6    Leader: 4       Replicas: 4,2,3 Isr: 4,2,3
       Topic: my-topic-two     Partition: 7    Leader: 1       Replicas: 1,3,0 Isr: 1,3,0
       Topic: my-topic-two     Partition: 8    Leader: 2       Replicas: 2,0,4 Isr: 2,0,4
       Topic: my-topic-two     Partition: 9    Leader: 3       Replicas: 3,4,1 Isr: 3,4,1
```
Note: Your topic details can vary and might not be same as the topic details present here. 

In the same way you can get the details for the other topic `my-topic` also.

```sh
Topic: my-topic TopicId: hoGc8CoZQwujm4JCLruDQw PartitionCount: 10      ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
       Topic: my-topic Partition: 0    Leader: 2       Replicas: 2,3,0 Isr: 2,3,0
       Topic: my-topic Partition: 1    Leader: 3       Replicas: 3,0,4 Isr: 3,0,4
       Topic: my-topic Partition: 2    Leader: 0       Replicas: 0,4,1 Isr: 0,4,1
       Topic: my-topic Partition: 3    Leader: 4       Replicas: 4,1,2 Isr: 4,1,2
       Topic: my-topic Partition: 4    Leader: 1       Replicas: 1,2,3 Isr: 1,2,3
       Topic: my-topic Partition: 5    Leader: 2       Replicas: 2,0,4 Isr: 2,0,4
       Topic: my-topic Partition: 6    Leader: 3       Replicas: 3,4,1 Isr: 3,4,1
       Topic: my-topic Partition: 7    Leader: 0       Replicas: 0,1,2 Isr: 0,1,2
       Topic: my-topic Partition: 8    Leader: 4       Replicas: 4,2,3 Isr: 4,2,3
       Topic: my-topic Partition: 9    Leader: 1       Replicas: 1,3,0 Isr: 1,3,0
```

From the above outputs, we see that `my-topic-two` has some replicas on broker 3 and 4 thus we need to reassign this topic onto other brokers. 

Let's create our `topics.json` file:
```json
{
  "version": 1,
  "topics": [
    { "topic": "my-topic-two"}
  ]
}
```

After creating this file, copy it to the interactive pod container since we will be running all of our commands from there:

```sh
kubectl cp topics.json my-pod:/tmp/topics.json
```

We can now start a shell process in our interactive pod container and run the command inside it to generate our proposal `reassignment.json` data.
Let's start the shell process:

```sh
kubectl exec -ti my-pod /bin/bash
```

Now it's time to generate the `reassignment.json` file. 
We will use the `kafka-reassign-partitions.sh` command to generate our proposal `reassignment.json` data:

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 \
--topics-to-move-json-file /tmp/topics.json \
--broker-list 0,1,2 \
--generate
```
Here `topics-to-move-json-file` points towards the `topics.json file` and `--broker-list` is the list of brokers we want to move our partitions onto.

Once you run this command, you will be able to see the JSON data which is generated by the Kafka reassignment partition tool. You get the current replica assignment and the proposed `reassignment.json` data.

```sh
Current partition replica assignment
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[0,4,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":1,"replicas":[4,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":2,"replicas":[1,2,3],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":3,"replicas":[2,3,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":4,"replicas":[3,0,4],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":5,"replicas":[0,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":6,"replicas":[4,2,3],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":7,"replicas":[1,3,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":8,"replicas":[2,0,4],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":9,"replicas":[3,4,1],"log_dirs":["any","any","any"]}]}

Proposed partition reassignment configuration
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[2,0,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":1,"replicas":[0,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":2,"replicas":[1,2,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":3,"replicas":[2,1,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":4,"replicas":[0,2,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":5,"replicas":[1,0,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":6,"replicas":[2,0,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":7,"replicas":[0,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":8,"replicas":[1,2,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":9,"replicas":[2,1,0],"log_dirs":["any","any","any"]}]}

```
Now you can copy this proposed partition reassignment and paste it in a `reassignment.json` file, which will be copied to our interactive pod container in the next step.

### Finishing up the reassignment

Let's copy the `reassignment.json` file to the interactive pod container.

```sh
kubectl cp reassignment.json my-pod:/tmp/reassignment.json
```

Now we'll start a shell process inside the interactive pod container to run our Kafka bin script.
```sh
kubectl exec -ti my-pod /bin/bash
```

So let's run the `kafka-reassign-partitions.sh` script now to start the partition reassignment 

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 \
--reassignment-json-file /tmp/reassignment.json \ 
--execute
```

If you want to throttle replication, you can also pass the --throttle option with an inter-broker throttled rate in bytes per second. For example:

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 \
--reassignment-json-file /tmp/reassignment.json \ 
--throttle <THROTTLE_BYTE_PER_SECOND> \
--execute
```

You can use the `--verify` action to check if the partition reassignment is done or if it is still running. You might have to run this command multiple times since it may take the process a while to complete.

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 \
--reassignment-json-file /tmp/reassignment.json \
--verify
```
The `--verify` action reports if the assignment is done or not.

```sh
Status of partition reassignment:
Reassignment of partition my-topic-two-0 is complete.
Reassignment of partition my-topic-two-1 is complete.
Reassignment of partition my-topic-two-2 is complete.
Reassignment of partition my-topic-two-3 is complete.
Reassignment of partition my-topic-two-4 is complete.
Reassignment of partition my-topic-two-5 is complete.
Reassignment of partition my-topic-two-6 is complete.
Reassignment of partition my-topic-two-7 is complete.
Reassignment of partition my-topic-two-8 is complete.
Reassignment of partition my-topic-two-9 is complete.

Clearing broker-level throttles on brokers 0,1,2,3,4
Clearing topic-level throttles on topic my-topic-two
```

When the partition reassignment is complete, the brokers we want to scale down will have no assigned partitions and can be removed safely. Note, if new topics are created before these brokers are removed from the cluster, partitions may be assigned to these brokers.

```sh
Topic: my-topic-two     TopicId: RBVQ5cTgRSK4TNnGXZFkKw PartitionCount: 10      ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
       Topic: my-topic-two     Partition: 0    Leader: 0       Replicas: 2,0,1 Isr: 0,1,2
       Topic: my-topic-two     Partition: 1    Leader: 0       Replicas: 0,1,2 Isr: 1,2,0
       Topic: my-topic-two     Partition: 2    Leader: 1       Replicas: 1,2,0 Isr: 1,2,0
       Topic: my-topic-two     Partition: 3    Leader: 2       Replicas: 2,1,0 Isr: 2,0,1
       Topic: my-topic-two     Partition: 4    Leader: 0       Replicas: 0,2,1 Isr: 0,1,2
       Topic: my-topic-two     Partition: 5    Leader: 0       Replicas: 1,0,2 Isr: 0,1,2
       Topic: my-topic-two     Partition: 6    Leader: 2       Replicas: 2,0,1 Isr: 0,1,2
       Topic: my-topic-two     Partition: 7    Leader: 1       Replicas: 0,1,2 Isr: 1,0,2
       Topic: my-topic-two     Partition: 8    Leader: 2       Replicas: 1,2,0 Isr: 2,0,1
       Topic: my-topic-two     Partition: 9    Leader: 2       Replicas: 2,1,0 Isr: 0,1,2
```
As you can see the partition are now removed from the pod to be scaled down and now they can be removed without any problems.

### Scaling down the cluster

Let's change the replicas to 3 now in the Kafka resource:

```sh
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    version: 3.1.0
    replicas: 3   // changed to 3 from 5
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
....        
```

Now apply the Kafka resource and check the pods in the namespace:
```sh
kubectl get pods
```

You will notice that `<CLUSTER-NAME>-kafka-3` and `<CLUSTER-NAME>-kafka-4` are removed:

```sh
NAME                                          READY   STATUS    RESTARTS   AGE
my-cluster-entity-operator-59b74b79b6-xwxgj   3/3     Running   0          3h28m
my-cluster-kafka-0                            1/1     Running   0          91s
my-cluster-kafka-1                            1/1     Running   0          2m32s
my-cluster-kafka-2                            1/1     Running   0          2m1s
my-cluster-zookeeper-0                        1/1     Running   2          3h31m
my-cluster-zookeeper-1                        1/1     Running   2          3h31m
my-cluster-zookeeper-2                        1/1     Running   0          3h31m
my-pod                                        1/1     Running   0          46m
strimzi-cluster-operator-8759c8f5d-z4n4v      1/1     Running   0          3h34m
```

# Conclusion

This example provides a brief introduction to the `--generate`, `--execute`, and `--verify` actions of the Kafka reassignment partition tool. These are the crucial points you should know before attempting reassigning partitions in your Kafka cluster.

You can also take a look at our documentation on using the partition reassignment tool for [Scaling up the Kafka cluster](https://strimzi.io/docs/operators/in-development/using.html#proc-scaling-up-a-kafka-cluster-str) and [Scaling down the Kafka cluster](https://strimzi.io/docs/operators/in-development/using.html#proc-scaling-down-a-kafka-cluster-str).
