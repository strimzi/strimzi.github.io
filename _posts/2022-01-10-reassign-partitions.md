---
layout: post
title:  "Reassigning partitions in Apache Kafka Cluster"
date: 2021-09-23
author: shubham_rawat
---

As Apache Kafka users, we sometimes have to scale up/down the number of Kafka brokers in our cluster depending on the use case.
Addition of extra brokers can be an advantage to handle increased load, and we can use Cruise Control for general rebalancing in Strimzi since it allows us to automate the balancing of load across the cluster but what if we are scaling down the clusters?
Let us understand this with the help of an example, suppose there are certain number of brokers in a cluster and now we want to remove a broker from the cluster.
We need to make sure that the broker which is going to be removed should not have any assigned partitions. Strimzi's integration of Cruise Control currently doesn't support doing this for you.
You have to use some other tool to assign the partitions from the broker to be removed, to the remaining brokers.
The most convenient tool for this job is the Kafka partition reassignment tool.

<!--more-->

##  Kafka reassignment partition tool

The `bin/kafka-reassign-partitions.sh` tool allows you to reassign partitions to different brokers.

While using the tool, you have to provide it with either of these two JSON files: `topics.json` and `reassignment.json`.
Wondering what these two JSON files really do? Let's talk a bit about them:

- The `topic.json` basically consists of the topics that we want to reassign or move. Based on this JSON file, our tool will generate a proposal `reassignment.json` that we can use directly or modify further.

- The `reassignment.json` file is a configuration file that is used during the partition reassignment process. The reassignment partition tool will generate a proposal `reassignment.json` file based on a `topics.json` file. You can change the `reassignment.json` file as per your requirement and use it.

## Why use the Kafka reassignment partition tool?

The Kafka reassignment partition tool can help you address a variety of use cases.

Some of these are listed here:

- You can reassign partitions between the brokers. For example, it can be used when you want to scale down the number of brokers in your cluster.
   You can assign partitions from the broker to be scaled down to other brokers which will handle these partitions now.

- You can increase the number of partitions / replicas which can help with increasing the throughput of topics.

## Partition Reassignment Throttle
Reassigning partitions between brokers often leads to additional interbroker network traffic, in addition to the normal traffic required for replication. To avoid overloading the cluster, it is recommended to always set a throttle rate to limit the bandwidth used by the reassignment. 
This can be done using the `--throttle` flag which sets the maximum allowed bandwidth in bytes per second, for example `--throttle 5000000` sets the limit to 5 MB/s.

Throttling might cause the reassignment to take longer to complete.

1. If the throttle is too low, the newly assigned brokers will not be able to keep up with records being published and the reassignment will never complete.

2. If the throttle is too high, the overall health of the cluster may be impacted.

The best way to set the value for throttle is to start with a safe value.
If the lag is growing, or decreasing too slowly to catch up within a reasonable time, then the throttle should be increased.
To do this, run the command again to increase the throttle, iterating until it looks like the broker will join the ISR within a reasonable time.

## Actions that can be executed while using the tool

It has three different actions:

| Action | Description |
| :-----------: | ------------- |
| `generate`  | Takes a set of topics and brokers and generates a reassignment JSON file. This action is optional if we already have `reassignment.json` file with us. You can use this action using `--generate`|
| `execute` | Takes a reassignment JSON file and applies it to the partitions and brokers in the cluster. The `reassignment.json` file can be either the one proposed by the `generate` action or written by the user. `--execute`  is used to carry out this action |
| `verify`  | Using the same reassignment JSON file as the `--execute` step, `--verify` checks whether all the partitions in the file have been moved to their intended brokers. If the reassignment is complete, `--verify` also removes any replication quotas (`--throttle`) that are in effect. Unless removed, throttles will continue to affect the cluster even after the reassignment has finished. This action can be executed using `--verify` |

## Example time

Let us understand the working of this tool with a concrete example.
Suppose we have 5 Kafka Brokers and after looking at the partition details we realize that the brokers are not too busy, so we can scale them down to 3.
Through this example we will take a look at how the three actions of the Kafka reassignment partition tool(`--generate`, `--execute` and `--verify`) work.
We will generate the JSON data that will be used in the `reassignment.json` file.
We will then assign the partitions to the remaining broker using the `reassignment.json` file.

Before proceeding towards the steps. Let's discuss one more curious question. Can you scale down any pod you want through this process?
So the answer to this question is no.
It is due to the fact Strimzi uses StatefulSets to manage broker pods.
The Kubernetes StatefulSet controller managed pods with contiguous numbers starting from 0.
So when scaling down it will always remove the the highest numbered pod(s).
For example, in a cluster of 5 brokers the pods are named `<CLUSTER-NAME>-kafka-0` up to `<CLUSTER-NAME>-kafka-4`.
If you decide to scale down by two brokers, then `<CLUSTER-NAME>-kafka-4` and `<CLUSTER-NAME>-kafka-3` will be removed.

 The next section will help you set up the environment for executing the above example, i.e. setting up your kafka cluster, kafka topics and also configuring the Kafka user with required ACL's.

Note: In case you already have the environment set up, you can skip the next section.

### Setting up the environment

To get the Kafka cluster up and running, we will first have to install the Strimzi Cluster Operator and then deploy the Kafka resource.
You can install the Cluster Operator with any installation method you prefer.
The Kafka cluster is then deployed with the plain listener enabled on port 9092.

Example Kafka configuration with plain listener.
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: <CLUSTER-NAME>
spec:
  kafka:
    replicas: 5
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
    storage:
      type: jbod
      volumes:
      - id: 0
        type: persistent-claim
        size: 100Gi
  zookeeper:
    replicas: 3
    storage:
      type: persistent-claim
      size: 100Gi
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
    strimzi.io/cluster: <CLUSTER-NAME>
spec:
  partitions: 10
  replicas: 3
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
    # ...
```

Now we require a Kafka user.
We will configure the Kafka user with ACL rules that grant permission to produce and consume topics from the Kafka brokers.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: <KAFKA-USER>
  labels:
    strimzi.io/cluster: <CLUSTER-NAME>
spec:
  authentication:
    type: tls
  authorization:
    type: simple
    acls:
      - resource:
          type: topic
          name: my-topic-two
          patternType: literal
        operation: Write
        host: "*"
      - resource:
          type: topic
          name: my-topic-two
          patternType: literal
        operation: Read
        host: "*"
      - resource:
          type: topic
          name: my-topic-two
          patternType: literal
        operation: Describe
        host: "*"   
      - resource:
           type: topic
           name: my-topic-two
           patternType: literal
        operation: DescribeConfigs
        host: "*"
      - resource:
           type: topic
           name: my-topic-two
           patternType: literal
        operation: AlterConfigs
        host: "*"        
      - resource:
           type: cluster
           name: <CLUSTER-NAME>
           patternType: literal
        operation: Alter
        host: "*"
      - resource:
           type: cluster
           name: <CLUSTER-NAME>
           patternType: literal
        operation: AlterConfigs
        host: "*"        
  # ...
```

### Creating a proposal `reassignment.json` file

When you have a Kafka cluster running with brokers and topics, you are ready to create the proposal JSON file.

Let us create a separate interactive pod.
This interactive pod is used to run all the reassignment commands. 
One question might bug you. What is the need of a separate pod? Can't we just use one of the broker pods?
In answer to this question, running commands from within a broker is not good practice.
It will start another JVM inside the container designated for the broker and can cause disruption, cause the container to run out of memory and so on.
So it is always better to avoid running the command from a broker pod.

So now it's time to get our interactive pod up and running. You can use the following command:

```sh
kubectl run --restart=Never --image=quay.io/strimzi/kafka:0.27.0-kafka-3.0.0 <INTERACTIVE-POD-NAME> -- /bin/sh -c "sleep 3600"
```

Wait till the pod gets into the `Ready` state. Once the pod gets into `Ready` state, now our next step will be to generate our `topics.json` file. 
As we discussed above, this file will have the topics that we need to reassign.


Now arises a good question. What topics require reassignment?
So the answer to this is the topics that have their partitions assigned to broker `<CLUSTER-NAME>-kafka-3` and `<CLUSTER-NAME>-kafka-4` need reassignment, or these topics partition should move to the remaining 3 brokers nodes in our cluster.

To check the partitions details of a certain topic, we can use the `kafka-topics.sh` tool. We can run the following command from inside interactive pod after starting a shell process using `kubectl exec -ti <INTERACTIVE-POD-NAME> /bin/bash`
:

```sh
bin/kafka-topics.sh --describe --topic my-topic-two --bootstrap-server <CLUSTER-NAME>-kafka-bootstrap:9092
```
which will give us the following output:

```shell
Topic: my-topic-two     TopicId: _aUFY9oMSjqBjvP9Ed3JDg PartitionCount: 10      ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
        Topic: my-topic-two     Partition: 0    Leader: 0       Replicas: 0,3,1 Isr: 0,3,1
        Topic: my-topic-two     Partition: 1    Leader: 1       Replicas: 1,0,4 Isr: 1,0,4
        Topic: my-topic-two     Partition: 2    Leader: 4       Replicas: 4,1,2 Isr: 4,1,2
        Topic: my-topic-two     Partition: 3    Leader: 2       Replicas: 2,4,3 Isr: 2,4,3
        Topic: my-topic-two     Partition: 4    Leader: 3       Replicas: 3,2,0 Isr: 3,2,0
        Topic: my-topic-two     Partition: 5    Leader: 0       Replicas: 0,1,4 Isr: 0,1,4
        Topic: my-topic-two     Partition: 6    Leader: 1       Replicas: 1,4,2 Isr: 1,4,2
        Topic: my-topic-two     Partition: 7    Leader: 4       Replicas: 4,2,3 Isr: 4,2,3
        Topic: my-topic-two     Partition: 8    Leader: 2       Replicas: 2,3,0 Isr: 2,3,0
        Topic: my-topic-two     Partition: 9    Leader: 3       Replicas: 3,0,1 Isr: 3,0,1
```
Note: Your topic details can vary and might not be same as the topic details present here. 

In the same way you can get the details for the other topic `my-topic` also.

```sh
Topic: my-topic TopicId: WyFKVZzLS8i54IGgm1ifrQ PartitionCount: 10      ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
        Topic: my-topic Partition: 0    Leader: 0       Replicas: 0,2,1 Isr: 0,2,1
        Topic: my-topic Partition: 1    Leader: 2       Replicas: 2,1,0 Isr: 0,2,1
        Topic: my-topic Partition: 2    Leader: 1       Replicas: 1,0,2 Isr: 0,2,1
        Topic: my-topic Partition: 3    Leader: 0       Replicas: 0,1,2 Isr: 0,2,1
        Topic: my-topic Partition: 4    Leader: 2       Replicas: 2,0,1 Isr: 0,2,1
        Topic: my-topic Partition: 5    Leader: 1       Replicas: 1,2,0 Isr: 0,2,1
        Topic: my-topic Partition: 6    Leader: 0       Replicas: 0,2,1 Isr: 0,2,1
        Topic: my-topic Partition: 7    Leader: 2       Replicas: 2,1,0 Isr: 0,2,1
        Topic: my-topic Partition: 8    Leader: 1       Replicas: 1,0,2 Isr: 0,2,1
        Topic: my-topic Partition: 9    Leader: 0       Replicas: 0,1,2 Isr: 0,2,1
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
kubectl cp topics.json <INTERACTIVE-POD-NAME>:/tmp/topics.json
```

We can now start a shell process in our interactive pod container and run the command inside it to generate our proposal `reassignment.json` data.
Let's start the shell process:

```sh
kubectl exec -ti <INTERACTIVE-POD-NAME> /bin/bash
```

Now it's time to generate the `reassignment.json` file. 
We will use the `kafka-reassign-partitions.sh` command to generate our proposal `reassignment.json` data:

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server <CLUSTER-NAME>-kafka-bootstrap:9092 \
--topics-to-move-json-file /tmp/topics.json \
--broker-list 0,1,2 \
--generate
```
Here `topics-to-move-json-file` points towards the `topics.json file` and `--broker-list` is the list of brokers we want to move our partitions onto.

Once you run this command, you will be able to see the JSON data which is generated by the Kafka reassignment partition tool. You get the current replica assignment and the proposed `reassignment.json` data.

```sh
Current partition replica assignment
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[0,3,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":1,"replicas":[1,0,4],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":2,"replicas":[4,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":3,"replicas":[2,4,3],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":4,"replicas":[3,2,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":5,"replicas":[0,1,4],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":6,"replicas":[1,4,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":7,"replicas":[4,2,3],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":8,"replicas":[2,3,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":9,"replicas":[3,0,1],"log_dirs":["any","any","any"]}]}

Proposed partition reassignment configuration
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[2,0,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":1,"replicas":[0,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":2,"replicas":[1,2,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":3,"replicas":[2,1,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":4,"replicas":[0,2,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":5,"replicas":[1,0,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":6,"replicas":[2,0,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":7,"replicas":[0,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":8,"replicas":[1,2,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-two","partition":9,"replicas":[2,1,0],"log_dirs":["any","any","any"]}]}

```
Now you can copy this proposed partition reassignment and paste it in a `reassignment.json` file, which will be copied to our interactive pod container in the next step.

### Finishing up the reassignment

Let's copy the `reassignment.json` file to the interactive pod container.

```sh
kubectl cp reassignment.json <INTERACTIVE-POD-NAME>:/tmp/reassignment.json
```

Now we'll start a shell process inside the interactive pod container to run our Kafka bin script.
```sh
kubectl exec -ti <INTERACTIVE-POD-NAME> /bin/bash
```

So let's run the `kafka-reassign-partitions.sh` script now to start the partition reassignment 

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server <CLUSTER-NAME>-kafka-bootstrap:9092 \
--reassignment-json-file /tmp/reassignment.json \ 
--execute
```

If you want to throttle replication, you can also pass the --throttle option with an inter-broker throttled rate in bytes per second. For example:

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server <CLUSTER-NAME>-kafka-bootstrap:9092 \
--reassignment-json-file /tmp/reassignment.json \ 
--throttle <THROTTLE_BYTE_PER_SECOND> \
--execute
```

You can use the `--verify` action to check if the partition reassignment is done or if it is still running. You might have to run this command multiple times since it may take the process a while to complete.

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server <CLUSTER-NAME>-kafka-bootstrap:9092 \
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
Topic: my-topic-two     TopicId: _aUFY9oMSjqBjvP9Ed3JDg PartitionCount: 10      ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
        Topic: my-topic-two     Partition: 0    Leader: 0       Replicas: 2,0,1 Isr: 0,1,2
        Topic: my-topic-two     Partition: 1    Leader: 1       Replicas: 0,1,2 Isr: 1,0,2
        Topic: my-topic-two     Partition: 2    Leader: 1       Replicas: 1,2,0 Isr: 1,2,0
        Topic: my-topic-two     Partition: 3    Leader: 2       Replicas: 2,1,0 Isr: 0,1,2
        Topic: my-topic-two     Partition: 4    Leader: 0       Replicas: 0,2,1 Isr: 2,0,1
        Topic: my-topic-two     Partition: 5    Leader: 0       Replicas: 1,0,2 Isr: 0,1,2
        Topic: my-topic-two     Partition: 6    Leader: 1       Replicas: 2,0,1 Isr: 1,2,0
        Topic: my-topic-two     Partition: 7    Leader: 0       Replicas: 0,1,2 Isr: 0,1,2
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
