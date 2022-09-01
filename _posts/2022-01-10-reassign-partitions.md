---
layout: post
title:  "Reassigning partitions in Apache Kafka Cluster"
date: 2021-09-23
author: shubham_rawat
---

Apache Kafka brokers host replicas of partitions. How many and which partitions each broker replicates affects the load on that broker.
One broker often ends up experiencing more load than others, and the most loaded broker can become a bottleneck within the cluster.
Strimzi supports the use of Cruise Control and we recommend using it to balance the load across the brokers.
That's because when there are more than a handful of partitions in your cluster it becomes very hard to find the best, or even a "good enough", assignment.
But sometimes you might need to make small changes to the replica assignment.

This blog post will guide you through when you might need to do reassignments using Kafka's partition reassignment rool, and how to do so.

<!--more-->

##  When to use the Kafka reassignment partition tool

As mentioned, we recommend using Cruise Control where possible.
Currently Strimzi offers first-class support for three use cases:

* Global cluster balancing.
  This uses the `KafkaRebalance` custom resource.
* Automatically assigning replicas to newly-added brokers. This uses a `KafkaRebalance` with `spec.mode` set to `add-broker`, which was added in Strimzi 0.29.
* Automatically reassigning replicas away from brokers prior to scaling down the cluster. This uses a `KafkaRebalance` with `spec.model` set to `remove-broker`. This was also added in Strimzi 0.29.

These use cases are covered extensively in [the documentation](https://strimzi.io/docs/operators/latest/configuring.html#cruise-control-concepts-str).
So if this is the kind of rebalancing you need you can stop reading the rest of this post.

The Strimzi community is also planning further integration with Cruise Control:

* Simplifying the existing rebalancing functionality using [auto-approval](https://github.com/strimzi/proposals/blob/main/038-optimization-proposal-autoapproval.md).
* Better supporting [changing the replication factor](https://github.com/strimzi/proposals/pull/50) of individual topics using the Topic Operator.

Until those improvements are implemented it's possible to use the reassignment tool for these cases.

There are a couple of other common use cases where the tool can be used:

* Changing the preferred leader of one or more partitions.
  Followed by forcing the election of the preferred leader, this can be used to change the leadership of a given partition.
* Moving data from one volume to another on the same broker.
  This is necessary prior to removing a volume from JBOD storage.
  (To utilise a newly added JBOD volume it's probably more convenient to perform a global rebalance using `KafkaRebalance` once the volume has been added).

In the rest of this post we'll dive into how the tool works, and then go through some examples based on these use cases.

## Tool modes

The `bin/kafka-reassign-partitions.sh` tool allows you to reassign partitions to different brokers or disks.

The tool has two fundamental modes of operation:

- `--execute`: This initiates a ressignment that you describe using a JSON file. We'll refer to this file throughout as reassignment.json, though you can name it how you like. Note that when the execution of an --execute command completes the reassignment has only been started.
- `--verify`: This checks whether reassignment that you previously started (using --execute) has actually completed.

Constructing a reassignment.json can be anything from a bit tedious to a piece of work in its own right. To help with this the tool provides an optional third mode, `--generate`, to generate one from a list of topics you provide in a different JSON file, which we'll be calling topics.json. You can use the reassignment.json that is produced by a --generate invocation directly, or modify it further prior to actually making changes using --execute.

## Partition Reassignment in detail

When you make changes to a partition's assignment to brokers there are three possible cases:

1. Changes which require moving data between brokers.
2. Changes which require moving data between volumes on _the same_ broker.
3. Change which require no data movement at all.

The first case leads to additional inter-broker network traffic, in addition to the normal traffic required for replication.
To avoid overloading the cluster, it is recommended to always set a throttle rate to limit the bandwidth used by the reassignment.
This can be done using the `--throttle` option in the `--execute` model.
This sets the maximum allowed bandwidth in bytes per second, for example `kafka-reassign-partitions.sh --execute --throttle 5000000 ...` would set the limit to 5 MB/s.

Throttling might cause the reassignment to take longer to complete.

* If the throttle is too low, the newly assigned brokers will not be able to keep up with records being published and the reassignment will never complete.

* If the throttle is too high, the overall health of the cluster may be impacted.

You can use the `kafka.server:type=FetcherLagMetrics,name=ConsumerLag,clientId=([-.\w]+),topic=([-.\w]+),partition=([0-9]+)` metric (which with the default `spec.kafka.metrics` settings in your Kafka CR would be named in Prometheus as `kafka_server-fetcherlagmetrics_consumerlag`) to observe how far the followers are lagging behind the leader. You can refer to this [example](https://github.com/strimzi/strimzi-kafka-operator/blob/main/packaging/examples/metrics/kafka-metrics.yaml) for configuring metrics

The best way to set the value for `--throttle` is to start with a safe value.
If the lag is growing, or decreasing too slowly to catch up within a reasonable time, then the throttle should be increased.
To do this, run the command again to increase the throttle, iterating until it looks like the broker will join the ISR within a reasonable time.

The `--verify` mode checks whether all the partitions in have been moved to their intended brokers, as defined by the `reassignment.json` file.
If the reassignment is complete, `--verify` also removes any replication quotas (`--throttle`) that are in effect.
Unless removed, throttles will continue to affect the cluster even after the reassignment has finished.

To summarise, a typical reasignment might look like this:

1. Start the reassignment: `kafka-reassign-partitions.sh --execute --throttle 5000000 ...`
2. Observe a growing lag
3. Increase the throttle: `kafka-reassign-partitions.sh --execute --throttle 8000000 ...`
4. Maybe now the lag is falling, but too slowly to expect the reassingment to be complete within a tolerable time.
5. So increase the throttle agin: `kafka-reassign-partitions.sh --execute --throttle 10000000 ...`
6. Check for completion: `kafka-reassign-partitions.sh --verify ...`, but it's not complete.
7. Check for completion: `kafka-reassign-partitions.sh --verify ...`, this time the reassignment is complete, so this invocation will have removed the throttle.

### Setting up the environment

Let's spin up an cluster where we can work through some reassignment examples.

To get the Kafka cluster up and running, we will first have to install the Strimzi Cluster Operator and then deploy the Kafka resource.
You can refer to the [Stimzi Quickstart Guide](https://strimzi.io/docs/operators/latest/quickstart.html) for installing Strimzi.

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
      version: 3.2.1
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
         inter.broker.protocol.version: "3.2"
      storage:
         type: jbod
         volumes:
            - id: 0
              type: persistent-claim
              size: 100Gi
              deleteClaim: false
            - id: 1
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

Finally, let us create a separate interactive pod for running the commands in.

> You may ask why we are using a separate pod to run the commands? Can't we just use one of the broker pods?
> The issue is that running commands from within a broker is not good practice.
> Running any of the Kafka `/bin` scripts from within the broker container will start another JVM (with all the same settings as the Kafka broker).
> This can cause disruption, including causing the container to run out of memory.
> So it is always better to avoid running the commands from a broker pod.

You can use the following command to create a pod called `my-pod`:

```sh
kubectl run --restart=Never --image=quay.io/strimzi/kafka:0.29.0-kafka-3.2.0 my-pod -- /bin/sh -c "sleep 3600"
```

Wait till the pod gets into the `Ready` state.
Once it is ready, we're all set to work through the examples.

## Example 1: Decreasing replication factor

When we just created the `my-topic-two` topic we specified `spec.replicas` as 4.
In hindsight that's actually more replicas than we need, so let's reduce it to 3.
To do this we can simply remove the last replica from the list of replicas of each partition of that topic.

Since we're operating on a single topic it's going to be easiest to use the `--generate` mode of `kafka-reassign-partitions.sh` and then edit that (either by hand or using a tool like [jq](https://stedolan.github.io/jq/)).

### Creating a proposal `reassignment.json` file

As we discussed above, this file will have the topics that we need to reassign.

Let's create our `topics.json` file in a file in the current directory of our local machine:
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
kubectl exec -ti my-pod /bin/bash -- bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 \
--topics-to-move-json-file /tmp/topics.json \
--broker-list 0,1,2,3 \
--generate
```
Here `topics-to-move-json-file` points towards the `topics.json file` and `--broker-list` is the list of brokers we want to move our partitions onto.

Once you run this command, you will be able to see the JSON data which is generated by the Kafka reassignment partition tool. You get the current replica assignment and the proposed `reassignment.json` data.

```json
Current partition replica assignment
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[3,4,2,0],"log_dirs":["any","any","any","any"]},{"topic":"my-topic-two","partition":1,"replicas":[0,2,3,1],"log_dirs":["any","any","any","any"]},{"topic":"my-topic-two","partition":2,"replicas":[1,3,0,4],"log_dirs":["any","any","any","any"]}]}

Proposed partition reassignment configuration
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[0,1,2,3],"log_dirs":["any","any","any","any"]},{"topic":"my-topic-two","partition":1,"replicas":[1,2,3,4],"log_dirs":["any","any","any","any"]},{"topic":"my-topic-two","partition":2,"replicas":[2,3,4,0],"log_dirs":["any","any","any","any"]}]}

```

You can copy this proposed partition reassignment and paste it in a local `reassignment.json` file

Edit the `reassignment.json` to remove a replica from each partition, for example using `jq` to simply remove the last replica in the list for each partition of the topic:

```sh
echo "$( jq 'del(.partitions[].replicas[3])' reassignment.json)" > reassignment.json
```

We then copy the modified `reassignment.json` file to the interactive pod container.

```sh
kubectl cp reassignment.json my-pod:/tmp/reassignment.json
```
Now we'll start a shell process inside the interactive pod container to run our Kafka bin script.

```sh
kubectl exec -ti my-pod /bin/bash -- bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 \
--reassignment-json-file /tmp/reassignment.json \
--execute
```
Because removing replicas from a broker doesn't require any interbroker data movement there is no need to supply a `--throttle` in this case.
(Interbroker data movement would be needed if you were increasing the replication factor, so in that case a `--throttle` would be recommended).
Since deleting data is very quick the reassignment will probably be complete almost immediately.
We can use the `--verify` action to when if the partition reassignment is done.

```sh
kubectl exec -ti my-pod /bin/bash -- bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 \
--reassignment-json-file /tmp/reassignment.json \
--verify
```

The `--verify` action reports if the assignment is done or not.

```sh
Status of partition reassignment:
Reassignment of partition my-topic-two-0 is complete.
Reassignment of partition my-topic-two-1 is complete.
Reassignment of partition my-topic-two-2 is complete.

Clearing broker-level throttles on brokers 0,1,2,3,4
Clearing topic-level throttles on topic my-topic-two
```

We can validate that each of the partitions now has three replicas:

Topic: my-topic-two     TopicId: Hj9OZs77T3CYiHmGpTz3QA PartitionCount: 3       ReplicationFactor: 3    Configs: min.insync.replicas=2,segment.bytes=1073741824,retention.ms=7200000,message.format.version=3.0-IV1
Topic: my-topic-two     Partition: 0    Leader: 2       Replicas: 0,1,2 Isr: 2,0,1
Topic: my-topic-two     Partition: 1    Leader: 3       Replicas: 1,2,3 Isr: 1,2,3
Topic: my-topic-two     Partition: 2    Leader: 0       Replicas: 2,3,0 Isr: 0,2,3

## Example 2: Changing the preferred leader

Let's now change the preferred leader of `my-topic-two` partition 0.

The preferred replica is the first one in the list of `Replicas` in the output above, so changing the order of the replicas will change the preferred leader.
However doing that won't, on it's own, force the current leadership to be changed to match the new preferred leader.
Let's start by editing our previous `reassignment.json` file to edit the order of the replicas for partition 0

```json
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[1,0,2]},{"topic":"my-topic-two","partition":1,"replicas":[1,2,3]},{"topic":"my-topic-two","partition":2,"replicas":[2,3,4]}]}
```
Now we can use the `--execute` mode to apply our new `reassignment.json` file

```sh
kubectl exec -ti my-pod /bin/bash -- bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 \
--reassignment-json-file /tmp/reassignment.json \
--execute
```
Now we can use the `--verify` mode to see if the assignment is done or not as we did in the previous example

Now we can see if the preferred leader is now changed or not

```shell
        Topic: my-topic-two     Partition: 0    Leader: 0       Replicas: 1,0,2 Isr: 0,1,2
        Topic: my-topic-two     Partition: 1    Leader: 2       Replicas: 1,2,3 Isr: 2,3,1
        Topic: my-topic-two     Partition: 2    Leader: 3       Replicas: 2,3,4 Isr: 2,3,4
```

## Example 3: Changing the log dirs 

Lets see how we can move a partition to use a certain JBOD volume.

Let say we have deployed a Kafka Resource with JBOD storage and deployed a topic with `spec.replicas` as 4.

Now our second task is to check which `logdir` are currently being used by Strimzi. You can use the `kafka-log-dir.sh` tool to check this

```shell
kubectl exec -n myproject -ti my-pod /bin/bash -- bin/kafka-log-dirs.sh --describe --bootstrap-server my-cluster-kafka-bootstrap:9092  --broker-list 0,1,2,3 --topic-list my-topic-two
```

You will get a `json` which represents the log directories being used by the brokers

```json
[
  {
    "broker": 0,
    "logDirs": [
      {
        "logDir": "/var/lib/kafka/data-0/kafka-log0",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-1",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          },
          {
            "partition": "my-topic-two-2",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      },
      {
        "logDir": "/var/lib/kafka/data-1/kafka-log0",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-0",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      }
    ]
  },
  {
    "broker": 1,
    "logDirs": [
      {
        "logDir": "/var/lib/kafka/data-1/kafka-log1",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-1",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      },
      {
        "logDir": "/var/lib/kafka/data-0/kafka-log1",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-2",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          },
          {
            "partition": "my-topic-two-0",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      }
    ]
  },
  {
    "broker": 2,
    "logDirs": [
      {
        "logDir": "/var/lib/kafka/data-0/kafka-log2",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-2",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      },
      {
        "logDir": "/var/lib/kafka/data-1/kafka-log2",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-0",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      }
    ]
  },
  {
    "broker": 3,
    "logDirs": [
      {
        "logDir": "/var/lib/kafka/data-0/kafka-log3",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-1",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      },
      {
        "logDir": "/var/lib/kafka/data-1/kafka-log3",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-0",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      }
    ]
  }
]
```

Now we can try to move `my-topic-two-1` to use the log directory `/var/lib/kafka/data-1/kafka-log0`


We can again generate the `reassignment.json` in the same way we generated it for the other examples.

```shell
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[0,3,1,2],"log_dirs":["any","any","any","any"]},{"topic":"my-topic-two","partition":1,"replicas":[1,0,2,3],"log_dirs":["any","any","any","any"]},{"topic":"my-topic-two","partition":2,"replicas":[2,1,3,0],"log_dirs":["any","any","any","any"]}]}
```

Lets edit our `reassignment.json`and make the changes in log directory for partition 1.

```json
{"version":1,"partitions":[{"topic":"my-topic-two","partition":0,"replicas":[0,3,1,2],"log_dirs":["any","any","any","any"]},{"topic":"my-topic-two","partition":1,"replicas":[1,0,2,3],"log_dirs":["any","/var/lib/kafka/data-1/kafka-log0","any","any"]},{"topic":"my-topic-two","partition":2,"replicas":[2,1,3,0],"log_dirs":["any","any","any","any"]}]}
```
Now we can use the `--execute` mode of the tool to apply our `reassignment.json` file and after that use the `--verify` mode to check if the assignment is done or not just like we did in the above steps.

 Once the assignment is done, you can check whether the log directory for partition 1 is now using the log directory `/var/lib/kafka/data-1/kafka-log0`

```json
[
  {
    "broker": 0,
    "logDirs": [
      {
        "logDir": "/var/lib/kafka/data-0/kafka-log0",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-2",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      },
      {
        "logDir": "/var/lib/kafka/data-1/kafka-log0",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-1",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          },
          {
            "partition": "my-topic-two-0",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      }
    ]
  },
  {
    "broker": 1,
    "logDirs": [
      {
        "logDir": "/var/lib/kafka/data-1/kafka-log1",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-1",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      },
      {
        "logDir": "/var/lib/kafka/data-0/kafka-log1",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-2",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          },
          {
            "partition": "my-topic-two-0",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      }
    ]
  },
  {
    "broker": 2,
    "logDirs": [
      {
        "logDir": "/var/lib/kafka/data-0/kafka-log2",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-1",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          },
          {
            "partition": "my-topic-two-2",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      },
      {
        "logDir": "/var/lib/kafka/data-1/kafka-log2",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-0",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      }
    ]
  },
  {
    "broker": 3,
    "logDirs": [
      {
        "logDir": "/var/lib/kafka/data-0/kafka-log3",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-1",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          },
          {
            "partition": "my-topic-two-2",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      },
      {
        "logDir": "/var/lib/kafka/data-1/kafka-log3",
        "error": null,
        "partitions": [
          {
            "partition": "my-topic-two-0",
            "size": 0,
            "offsetLag": 0,
            "isFuture": false
          }
        ]
      }
    ]
  }
]
```

# Conclusion

In this post we've discussed the use cases where you can use Strimzi's KafkaRebalance CR for partition reassignment. We've looked in more detail at the use cases where you have to reassign partitions manually.

We've explained the the different modes of the kafka-reassign-partitions.sh tool (--generate, --execute, and --verify) and seen examples of using it for the manual reassignment cases.

You can also take a look at our documentation on using the partition reassignment tool for Scaling up the Kafka cluster and Scaling down the Kafka cluster.
