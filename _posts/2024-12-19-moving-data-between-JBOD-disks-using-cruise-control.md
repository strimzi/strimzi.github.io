---
layout: post
title: "Moving data between the JBOD disks using Cruise Control"
date: 2024-12-19
author: shubham_rawat
---

Apache Kafka is a platform which provides durability and fault tolerance by storing messages on disks and JBOD storage is one of the storage configuration types supported by Kafka.
The JBOD data storage configuration allows Kafka brokers to make use of multiple disks.
Using JBOD storage, you can increase the data storage capacity for Kafka nodes, which can further lead to performance improvements.
In case you plan to remove a disk, and it contains some partition replicas, then you need to make sure that data is safely moved to some other disks.
If the data is not removed from the disk, and it is removed then potential data loss can happen.
Currently, moving data between the JBOD disks is done using the `kafka-reassign-partitions.sh` tool which is not very user-friendly, therefore in Strimzi 0.45.0 we are introducing the ability to move data between the JBOD disks using Cruise Control

## Cruise Control to move data between JBOD disks

This feature will allow you to move the data between the JBOD disks using the `KafkaRebalance` custom resource that we have in Strimzi.
This feature makes use of the `remove-disks` endpoint of Cruise Control that triggers a rebalancing operation which moves replicas, starting with the largest and proceeding to the smallest, to the remaining disks. 

## Setting up the environment

Let's set up a cluster to work through an example demonstrating this feature.
To get the Kafka cluster up and running, we will first have to install the Strimzi Cluster Operator and then deploy the `Kafka` resource.
You can install the Cluster Operator with any installation method you prefer.
For example by following the [Stimzi Quickstart Guide](https://strimzi.io/quickstarts/).

Then we will deploy the Kafka cluster with JBOD storage and Cruise Control enabled.
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-a
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  roles:
    - broker
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
      - id: 2
        type: persistent-claim
        size: 100Gi
        deleteClaim: false
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-b
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  roles:
    - broker
  storage:
    type: jbod
    volumes:
      - id: 0
        type: persistent-claim
        size: 200Gi
        deleteClaim: false
---

apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/node-pools: enabled
spec:
  kafka:
    version: 3.9.0
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
      inter.broker.protocol.version: "3.9"
  zookeeper:
    replicas: 3
    storage:
      type: persistent-claim
      size: 100Gi
      deleteClaim: false
  entityOperator:
    topicOperator: {}
    userOperator: {}
  cruiseControl: {}
```

Once the Kafka cluster is ready, now you can create some topics so that the volumes on brokers will contain some partition replicas.
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: my-topic
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 6
  replicas: 6
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
```

Once you create the topic, now you can check whether the volumes have some partition replicas assigned to them or not using the `kafka-log-dir.sh` tool. Let's see the partition replicas assigned to the volumes on broker with id 0.
```shell
kubectl exec -n myproject -ti my-cluster-pool-a-0   /bin/bash -- bin/kafka-log-dirs.sh --describe --bootstrap-server my-cluster-kafka-bootstrap:9092  --broker-list 0,1,2 --topic-list my-topic
```

Output:
```json
{
  "brokers": [
    {
      "broker": 0,
      "logDirs": [
        {
          "partitions": [
            {
              "partition": "my-topic-5",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            },
            {
              "partition": "my-topic-2",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-2/kafka-log0"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-0",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            },
            {
              "partition": "my-topic-3",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-0/kafka-log0"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-4",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            },
            {
              "partition": "my-topic-1",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-1/kafka-log0"
        }
      ]
    }
  ]
}
```

Now lets try to move the data of volume 1 and volume 2 to volume 0, present on broker with ID 0. For doing that let's create a `KafkaRebalance` resource with `remove-disks` mode.
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaRebalance
metadata:
  name: my-rebalance
  labels:
    strimzi.io/cluster: my-cluster
# no goals specified, using the default goals from the Cruise Control configuration
spec:
  mode: remove-disks
  moveReplicasOffVolumes:
    - brokerId: 0
      volumeIds: [1, 2]
```

Now let’s wait for the `KafkaRebalance` resource to move to `ProposalReady` state. You can check the rebalance summary by running the following command once the proposal is ready:
```shell
kubectl get kafkarebalance my-rebalance -n myproject -o yaml
```

and you should be able to get an output like this:
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaRebalance
metadata:
  creationTimestamp: "2024-11-13T06:55:41Z"
  generation: 1
  labels:
    strimzi.io/cluster: my-cluster
  name: my-rebalance
  namespace: myproject
  resourceVersion: "5354"
  uid: 7aacb9b0-489b-4d73-bfd7-bafbac676109
spec:
  mode: remove-disks
  moveReplicasOffVolumes:
  - brokerId: 0
    volumeIds:
    - 1
    - 2
status:
  conditions:
  - lastTransitionTime: "2024-11-13T06:55:42.217794891Z"
    status: "True"
    type: ProposalReady
  observedGeneration: 1
  optimizationResult:
    afterBeforeLoadConfigMap: my-rebalance
    dataToMoveMB: 0
    excludedBrokersForLeadership: []
    excludedBrokersForReplicaMove: []
    excludedTopics: []
    intraBrokerDataToMoveMB: 0
    monitoredPartitionsPercentage: 100
    numIntraBrokerReplicaMovements: 26
    numLeaderMovements: 0
    numReplicaMovements: 0
    onDemandBalancednessScoreAfter: 100
    onDemandBalancednessScoreBefore: 0
    provisionRecommendation: ""
    provisionStatus: UNDECIDED
    recentWindows: 1
  sessionId: 24537b9c-a315-4715-8e86-01481e914771
```

Now you can use the `approve` annotation to apply the generated proposal.
Once the rebalance is complete, you can then use the `kafka-log-dirs.sh` tool again to check if the data moved or not:
```shell
 kubectl exec -n myproject -ti my-cluster-pool-a-0   /bin/bash -- bin/kafka-log-dirs.sh --describe --bootstrap-server my-cluster-kafka-bootstrap:9092  --broker-list 0 --topic-list my-topic
 ```

Output:
```yaml
{
  "brokers": [
    {
      "broker": 0,
      "logDirs": [
        {
          "partitions": [],
          "error": null,
          "logDir": "/var/lib/kafka/data-2/kafka-log0"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-4",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            },
            {
              "partition": "my-topic-5",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            },
            {
              "partition": "my-topic-0",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            },
            {
              "partition": "my-topic-1",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            },
            {
              "partition": "my-topic-2",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            },
            {
              "partition": "my-topic-3",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-0/kafka-log0"
        },
        {
          "partitions": [],
          "error": null,
          "logDir": "/var/lib/kafka/data-1/kafka-log0"
        }
      ]
```

As you can see in the output, the data has moved from volume 1 and volume 2, and they now don’t have any partition replicas on them. All the partition replicas are now moved to volume 0 on broker with ID 0.

### Additional notes

1. This feature only works if JBOD storage is enabled
2. Make sure you have more than one volume per broker else you will be prompted of not having enough volumes to move the data to.
3. This endpoint does not provide `before` load since upstream Cruise Control project does not support `verbose` with this endpoint so the `loadmap` generated should only have `afterLoad` information.

## What's next

We hope this blog post has provided you with a clear understanding of how you can use the `KafkaRebalance` custom resource in `remove-disks` to easily move the data between the JBOD disks. 
If you get stuck on any step or have any doubts, you can have read about this in or documentation on [Using Cruise Control to reassign parititon on JBOD disk](https://strimzi.io/docs/operators/latest/deploying#proc-cruise-control-moving-data-str)