---
layout: post
title:  "Reassigning partitions in Apache Kafka Cluster"
date: 2021-09-23
author: shubham_rawat
---

As an Apache Kafka user, we sometimes have to scale up/down the number of Kafka brokers in our cluster depending on the use case.
Addition of extra brokers can be an advantage to handle massive load, and we can use Cruise Control for general rebalancing in Strimzi since it allows us to automate the balancing of load across the cluster but what if we are scaling down the clusters.
Let us understand this with the help of an example, suppose there are certain number of brokers in a cluster and now we want to remove a broker from the cluster.
We need to make sure that the broker which is going to be removed should not have any assigned partitions. Strimzi's integration of Cruise Control currently doesn't support scaling down the cluster.
This requires a tool that can assign the partitions from the broker to be removed, to the remaining brokers.
The most convenient tool for this job is the Kafka reassignment partition tool.

<!--more-->

##  Kafka reassignment partition tool

The `bin/kafka-reassign-partitions.sh` tool allows you to reassign partitions to different brokers.

While using the tool, you have to provide it with two essential JSON files: `topics.json` and `reassignment.json`.
Wondering what these two JSON files really do? Let's talk a bit about them:

- The `topic.json` basically consists of the topics that we want to reassign or move. Based on this JSON file, our tool will generate a proposal `reassignment.json` that we can use directly or modify further.

- The `reassignment.json` file is a configuration file that is used during the partition reassignment process. The reassignment partition tool will generate a proposal `reassignment.json` file based on a `topics.json` file. You can change the `reassignment.json` file as per your requirement and use it.

It has three different phases:

| Phases | Description |
| :-----------: | ------------- |
| `generate`  | Takes a set of topics and brokers and generates a reassignment JSON file which will result in the partitions of those topics being assigned to those brokers. Because this operates on whole topics, it cannot be used when you only want to reassign some partitions for some topics.|
| `execute` | Takes a reassignment JSON file and applies it to the partitions and brokers in the cluster. The `reassignment.json` file can be either the one proposed by the `--generate` command or written by the user itself. |
| `verify`  | Using the same reassignment JSON file as the `--execute` step, `--verify` checks whether all the partitions in the file have been moved to their intended brokers. If the reassignment is complete, `--verify` also removes any traffic throttles (`--throttle`) that are in effect. Unless removed, throttles will continue to affect the cluster even after the reassignment has finished. |

## Why use the Kafka reassignment partition tool?

The Kafka reassignment partition tool can help you address a variety of use cases.

Some of these are listed here:

1. You can reassign the partition between the brokers anytime. For example, it can be used at times when you want to scale down the number of brokers in your cluster.
   You can assign partitions from the broker to be scaled down to other brokers which will handle these partitions now.

2. With the help of this tool, you can increase the no. of partitions / replicas which can help with increasing the throughput of the topic.

## Example time

Let us understand the working of this tool with an interesting problem
Suppose we have 5 Kafka Brokers and after looking at the partition details we get to realize that the brokers are not too busy, so we can scale them down to 3.
Through this example we will take a look at how the three phases of the Kafka reassignment partition tool(`--generate`, `--execute` and `--verify`) works.
We will generate the JSON data that will be used in the `reassignment.json` file.
We will then assign the partitions to the remaining broker using the `reassignment.json` file.
The Kafka Cluster that we will use, will be configured to use PLAIN listener.
Strimzi supports *TLS*, *SCRAM-SHA-512*, *OAUTH*, and *PLAIN* configuration options for authentication.

Before proceeding towards the steps. Let's discuss one more curious question. Can you scale down any pod you want through this process?
So the answer to this question is no. Wondering why?
It is due to the fact Strimzi uses StatefulSets to manage broker pods. So you cannot remove any pod from the cluster.
You can only remove one or more of the highest numbered pods from the cluster. For example, in a cluster of 5 brokers the pods are named `<CLUSTER-NAME>-kafka-0` up to `<CLUSTER-NAME>-kafka-4`.
If you decide to scale down by two brokers, then `<CLUSTER-NAME>-kafka-4` and `<CLUSTER-NAME>-kafka-3` will be removed.

### Preparing to scale down the number of Kafka Brokers

This example will use a Kafka cluster deployed with the Strimzi Cluster Operator.
Before we start with anything, we have to install the Strimzi Cluster Operator and deploy the Kafka cluster.
You can install the Cluster Operator with any installation method you prefer.
The Kafka cluster is then deployed with the PLAIN listener enabled on port 9092.

Example Kafka configuration with PLAIN authentication.
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

Once the cluster is running, lets deploy some topics where we will send and receive the messages.
Here is an example topic configuration. You can change it to suit your requirements.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: my-topic-1
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

Now we require a kafka user.
We will configure the kafka user with ACL rules that specify permission to produce and consume topics from the Kafka brokers.

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
          name: my-topic-1
          patternType: literal
        operation: Write
        host: "*"
      - resource:
          type: topic
          name: my-topic-1
          patternType: literal
        operation: Read
        host: "*"
      - resource:
          type: topic
          name: my-topic-1
          patternType: literal
        operation: Describe
        host: "*"   
      - resource:
           type: topic
           name: my-topic-1
           patternType: literal
        operation: DescribeConfigs
        host: "*"
      - resource:
           type: topic
           name: my-topic-1
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
In answer to this question, running commands from within a broker is not good practice as it's insecure
It will start another JVM inside the container designated for the broker and can cause disruption, cause the container to run out of memory and so on.
So it is always better to avoid running the command from a broker pod.

So now it's time to get our interactive pod up and running. You can use the following command:

```sh
kubectl run --restart=Never --image=quay.io/strimzi/kafka:0.27.0-kafka-3.0.0 <INTERACTIVE-POD-NAME> -- /bin/sh -c "sleep 3600"
```

Wait till the pod gets into the `Ready` state. Once the pod gets into `Ready` state, now our next step will be to generate our `topics.json` file. 

Now arises a good question. What topics require reassignment?
So the answer to this is the topics that have their partitions assigned to <CLUSTER-NAME>-kafka-4 and <CLUSTER-NAME>-kafka-5 need to reassigned to 

Time to create a `topics.json` file now. As we discussed above, this file will have the topics that we need to reassign:
Now arises a good question. What topics require reassignment?
So the answer to this is the topics that have their partitions assigned to broker `<CLUSTER-NAME>-kafka-3` and `<CLUSTER-NAME>-kafka-4` needs reassignment, and these topics partition should move to the remaining 3 brokers nodes in our cluster.

To check the partitions details of a certain topic, we can use the `kafka-topics.sh` tool. We can run the following command:

```sh
bin/kafka-topics.sh --describe --topic my-topic-1 --bootstrap-server <CLUSTER-NAME>-kafka-bootstrap:9093 --command-config /tmp/config.properties
```
which will give us the following output:

```shell
Topic: my-topic-1       TopicId: bW1J-3OESJ2MF6buaLkkkQ PartitionCount: 10      ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
        Topic: my-topic-1       Partition: 0    Leader: 2       Replicas: 2,3,0 Isr: 2,3,0
        Topic: my-topic-1       Partition: 1    Leader: 3       Replicas: 3,0,1 Isr: 3,0,1
        Topic: my-topic-1       Partition: 2    Leader: 0       Replicas: 0,1,4 Isr: 0,1,4
        Topic: my-topic-1       Partition: 3    Leader: 1       Replicas: 1,4,2 Isr: 1,4,2
        Topic: my-topic-1       Partition: 4    Leader: 4       Replicas: 4,2,3 Isr: 4,2,3
        Topic: my-topic-1       Partition: 5    Leader: 2       Replicas: 2,0,1 Isr: 2,0,1
        Topic: my-topic-1       Partition: 6    Leader: 3       Replicas: 3,1,4 Isr: 3,1,4
        Topic: my-topic-1       Partition: 7    Leader: 0       Replicas: 0,4,2 Isr: 0,4,2
        Topic: my-topic-1       Partition: 8    Leader: 1       Replicas: 1,2,3 Isr: 1,2,3
        Topic: my-topic-1       Partition: 9    Leader: 4       Replicas: 4,3,0 Isr: 4,3,0
```
In the same way you can get the details for the other topic`my-topic` also.

```sh
Topic: my-topic TopicId: ERoAsjHHTIKFRPoo3h_ZZg PartitionCount: 10      ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
        Topic: my-topic Partition: 0    Leader: 1       Replicas: 1,2,0 Isr: 0,1,2
        Topic: my-topic Partition: 1    Leader: 2       Replicas: 2,0,1 Isr: 2,1,0
        Topic: my-topic Partition: 2    Leader: 0       Replicas: 0,1,2 Isr: 0,1,2
        Topic: my-topic Partition: 3    Leader: 0       Replicas: 1,0,2 Isr: 0,2,1
        Topic: my-topic Partition: 4    Leader: 1       Replicas: 2,1,0 Isr: 1,0,2
        Topic: my-topic Partition: 5    Leader: 0       Replicas: 0,2,1 Isr: 1,2,0
        Topic: my-topic Partition: 6    Leader: 2       Replicas: 1,2,0 Isr: 0,1,2
        Topic: my-topic Partition: 7    Leader: 2       Replicas: 2,0,1 Isr: 2,0,1
        Topic: my-topic Partition: 8    Leader: 0       Replicas: 0,1,2 Isr: 0,1,2
        Topic: my-topic Partition: 9    Leader: 1       Replicas: 1,0,2 Isr: 1,0,2
```

From the above outputs, we got to know that `my-topic-1` needs reassignment, Now we can create the topics.json file easily.

```json
{
  "version": 1,
  "topics": [
    { "topic": "my-topic-1"}
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
Here `topics-to-move-json-file` points towards the `topics.json file` and `--broker-list` is the list of broker which will now handle the partitions which are present with the broker to be scaled down.

Once you run this command, you will be able to see the JSON data which is generated by the Kafka reassignment partition tool. You get the current replica assignment and the proposed `reassignment.json` data.

```shell
Current partition replica assignment
{"version":1,"partitions":[{"topic":"my-topic-1","partition":0,"replicas":[2,3,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":1,"replicas":[3,0,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":2,"replicas":[0,1,4],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":3,"replicas":[1,4,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":4,"replicas":[4,2,3],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":5,"replicas":[2,0,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":6,"replicas":[3,1,4],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":7,"replicas":[0,4,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":8,"replicas":[1,2,3],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":9,"replicas":[4,3,0],"log_dirs":["any","any","any"]}]}

Proposed partition reassignment configuration
{"version":1,"partitions":[{"topic":"my-topic-1","partition":0,"replicas":[0,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":1,"replicas":[1,2,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":2,"replicas":[2,0,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":3,"replicas":[0,2,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":4,"replicas":[1,0,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":5,"replicas":[2,1,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":6,"replicas":[0,1,2],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":7,"replicas":[1,2,0],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":8,"replicas":[2,0,1],"log_dirs":["any","any","any"]},{"topic":"my-topic-1","partition":9,"replicas":[0,2,1],"log_dirs":["any","any","any"]}]}
```
Now you can create a `reassignment.json` file and copy this proposed `reassignment.json` data to use in the `reassignment.json` file. You can also create/alter the `reassignment.json` data in the file.

### Scaling down the cluster

Coming to the last step of this example, Here we will see how we use the generated `reassignment.json` to get the reassignment done by the reassignment partition tool.

Since we have copied the `reassignment.json` data into the `reassignment.json` file in the previous step, now we can use it for our next step.

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

You can use the `--verify` mode to check if the partition reassignment is done or if it is still running.

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server <CLUSTER-NAME>-kafka-bootstrap:9092 \
  --reassignment-json-file /tmp/reassignment.json \
  --verify
```
The `--verify` mode reports if the assignment is done or not.

```shell
Status of partition reassignment:
Reassignment of partition my-topic-1-0 is complete.
Reassignment of partition my-topic-1-1 is complete.
Reassignment of partition my-topic-1-2 is complete.
Reassignment of partition my-topic-1-3 is complete.
Reassignment of partition my-topic-1-4 is complete.
Reassignment of partition my-topic-1-5 is complete.
Reassignment of partition my-topic-1-6 is complete.
Reassignment of partition my-topic-1-7 is complete.
Reassignment of partition my-topic-1-8 is complete.
Reassignment of partition my-topic-1-9 is complete.

Clearing broker-level throttles on brokers 0,1,2,3,4
Clearing topic-level throttles on topic my-topic-1  
```

When the partition reassignment is complete, the scaled down brokers will have no assigned partitions and can be removed safely. You can check it by looking at the partition details of the reassigned topic.

```shell
        Topic: my-topic-1       Partition: 0    Leader: 2       Replicas: 0,1,2 Isr: 2,0,1
        Topic: my-topic-1       Partition: 1    Leader: 1       Replicas: 1,2,0 Isr: 0,1,2
        Topic: my-topic-1       Partition: 2    Leader: 0       Replicas: 2,0,1 Isr: 0,1,2
        Topic: my-topic-1       Partition: 3    Leader: 1       Replicas: 0,2,1 Isr: 1,2,0
        Topic: my-topic-1       Partition: 4    Leader: 1       Replicas: 1,0,2 Isr: 0,1,2
        Topic: my-topic-1       Partition: 5    Leader: 2       Replicas: 2,1,0 Isr: 2,0,1
        Topic: my-topic-1       Partition: 6    Leader: 0       Replicas: 0,1,2 Isr: 0,1,2
        Topic: my-topic-1       Partition: 7    Leader: 0       Replicas: 1,2,0 Isr: 0,2,1
        Topic: my-topic-1       Partition: 8    Leader: 1       Replicas: 2,0,1 Isr: 1,2,0
        Topic: my-topic-1       Partition: 9    Leader: 0       Replicas: 0,2,1 Isr: 0,1,2   
```
As you can see the partition are now removed from the pod to be scaled down and now they can be removed without any problems. 

# Conclusion

This example provides a brief introduction to the `--generate`, `--execute`, and `--verify` modes of the Kafka reassignment partition tool. These are the crucial points you should know before attempting a reassignment of partitions in your Kafka cluster.

You can also take a look at our documentation on using the partition reassignment file for [Scaling up the Kafka cluster](https://strimzi.io/docs/operators/in-development/using.html#proc-scaling-up-a-kafka-cluster-str) and [Scaling down the Kafka cluster](https://strimzi.io/docs/operators/in-development/using.html#proc-scaling-down-a-kafka-cluster-str).
