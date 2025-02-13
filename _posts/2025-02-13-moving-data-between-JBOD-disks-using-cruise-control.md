---
layout: post
title: "Moving data between JBOD disks using Cruise Control"
date: 2025-02-13
author: shubham_rawat
---

Apache Kafka is a platform that provides durability and fault tolerance by storing messages on persistent volumes.
In most cases, each Kafka broker will use one persistent volume.
However, it is also possible to use multiple volumes for each broker.
This configuration is called JBOD storage.
Using JBOD storage, you can increase the data storage capacity for Kafka nodes, which can further lead to performance improvements.
It might happen that you need to add or remove volumes to increase or shrink the overall capacity and performance of the Kafka cluster.
When adding new volumes, you first need to add the volume and then move some data to it.
That can be done using the [_intra-broker_](https://strimzi.io/docs/operators/in-development/deploying#con-rebalance-str) rebalance.
When removing volumes, you have to safely move the data to other volumes first.
Failing to do so could result in data loss.
Data movement between JBOD disks can be managed using the `kafka-reassign-partitions.sh` tool, though it is not particularly user-friendly.
To simplify this process, Strimzi 0.45.0 introduces support for moving data between JBOD disks using Cruise Control.

### New remove-disks mode in KafkaRebalance

The new `remove-disks` mode allows you to move the data from one JBOD disk to another JBOD disk using Strimzi's `KafkaRebalance` custom resource.
This feature makes use of the `remove-disks` endpoint of Cruise Control that triggers a rebalancing operation which moves all replicas, starting with the largest and proceeding to the smallest, to the remaining disks.

### Setting up the environment

Let's set up a cluster to work through an example demonstrating this feature.
In the example we will see how to safely remove the JBOD disks by moving the data from one disk to another, and we will use `Kafka` and `KafkaNodePool` resources to create a KRaft cluster.
Then, we create a `KafkaRebalance` resource in `remove-disks` mode, specifying the brokers and volume IDs for partition reassignment.
After generating the optimization proposal, we approve it to move the data.

To get the KRaft cluster up and running, we will first have to install the Strimzi Cluster Operator and then deploy the `Kafka` and `KafkaNodePool` resources.
You can install the Cluster Operator with the installation method you prefer, which are described in the [Strimzi documentation](https://strimzi.io/docs/operators/in-development/deploying#con-strimzi-installation-methods_str).

Let's deploy a KRaft cluster with JBOD storage and Cruise Control enabled.
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: controller
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[0-2]"
spec:
  replicas: 3
  roles:
    - controller
  storage:
    type: jbod
    volumes:
      - id: 0
        type: persistent-claim
        size: 100Gi
        kraftMetadata: shared
        deleteClaim: false
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: broker
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[3-5]"
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
        # Indicates that this directory will be used to store Kraft metadata log
        kraftMetadata: shared
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
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/node-pools: enabled
    strimzi.io/kraft: enabled
spec:
  kafka:
    version: 3.9.0
    metadataVersion: 3.9-IV0
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
  entityOperator:
    topicOperator: {}
    userOperator: {}
  cruiseControl: {}
```

Once the Kafka cluster is ready, you can create some topics so that the volumes on brokers contain partition replicas.
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

Let's see the partition replicas assigned to the volumes on the brokers using the `kafka-log-dir.sh` tool and a helper pod named `my-pod`.
```shell
kubectl -n myproject run my-pod -ti --image=quay.io/strimzi/kafka:0.45.0-kafka-3.9.0 --rm=true --restart=Never -- bin/kafka-log-dirs.sh --describe --bootstrap-server my-cluster-kafka-bootstrap:9092  --broker-list 3,4,5 --topic-list my-topic
```

Output:
```json
{
  "brokers": [
    {
      "broker": 4,
      "logDirs": [
        {
          "partitions": [
            {
              "partition": "my-topic-0",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-2/kafka-log4"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-1",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-0/kafka-log4"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-2",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-1/kafka-log4"
        }
      ]
    },
    {
      "broker": 5,
      "logDirs": [
        {
          "partitions": [
            {
              "partition": "my-topic-2",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-1/kafka-log5"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-0",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-0/kafka-log5"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-1",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-2/kafka-log5"
        }
      ]
    },
    {
      "broker": 3,
      "logDirs": [
        {
          "partitions": [
            {
              "partition": "my-topic-0",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-0/kafka-log3"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-2",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-2/kafka-log3"
        },
        {
          "partitions": [
            {
              "partition": "my-topic-1",
              "size": 0,
              "offsetLag": 0,
              "isFuture": false
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-1/kafka-log3"
        }
      ]
    }
  ],
  "version": 1
}
```

Next, let's move the data from volumes 1 and 2 to volume 0 for all the brokers.
To do that, we create a `KafkaRebalance` resource and specify `remove-disks` mode.
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
    - brokerId: 3
      volumeIds:
        - 1
        - 2
    - brokerId: 4
      volumeIds:
        - 1
        - 2
    - brokerId: 5
      volumeIds:
        - 1
        - 2
```

Now let’s wait for the `KafkaRebalance` resource to move to `ProposalReady` state. You can check the rebalance summary by running the following command once the proposal is ready:
```shell
kubectl get kafkarebalance my-rebalance -n myproject -o yaml
```

And you should be able to get an output like this:
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaRebalance
metadata:
  creationTimestamp: "2025-01-15T10:20:37Z"
  generation: 1
  labels:
    strimzi.io/cluster: my-cluster
  name: my-rebalance
  namespace: myproject
  resourceVersion: "1755"
  uid: 335ee6b2-59d2-4326-a690-00278d125abd
spec:
  mode: remove-disks
  moveReplicasOffVolumes:
    - brokerId: 3
      volumeIds:
        - 1
        - 2
    - brokerId: 4
      volumeIds:
        - 1
        - 2
    - brokerId: 5
      volumeIds:
        - 1
        - 2
status:
  conditions:
    - lastTransitionTime: "2025-01-15T10:20:52.882813259Z"
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
    numIntraBrokerReplicaMovements: 135
    numLeaderMovements: 0
    numReplicaMovements: 0
    onDemandBalancednessScoreAfter: 100
    onDemandBalancednessScoreBefore: 0
    provisionRecommendation: ""
    provisionStatus: UNDECIDED
    recentWindows: 1
  sessionId: 028a7dc8-8f6d-485e-8580-93225528b587
```

Now you can use the `approve` annotation to apply the generated proposal.
If the `strimzi.io/rebalance-auto-approval` annotation is set to `true` in the `KafkaRebalance` resource, the Cluster Operator will approve the proposal automatically.
For more details, you can refer to our [Strimzi documentation](https://strimzi.io/docs/operators/latest/deploying#con-optimization-proposals-str).

After the rebalance is complete, we use the `kafka-log-dirs.sh` tool again to verify that the data has been moved.
```shell
kubectl -n myproject run my-pod -ti --image=quay.io/strimzi/kafka:0.45.0-kafka-3.9.0 --rm=true --restart=Never -- bin/kafka-log-dirs.sh --describe --bootstrap-server my-cluster-kafka-bootstrap:9092  --broker-list 3,4,5 --topic-list my-topic
 ```

Output:
```yaml
{
  "brokers": [
    {
      "broker": 4,
      "logDirs": [
        {
          "partitions": [],
          "error": null,
          "logDir": "/var/lib/kafka/data-2/kafka-log4"
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
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-0/kafka-log4"
        },
        {
          "partitions": [],
          "error": null,
          "logDir": "/var/lib/kafka/data-1/kafka-log4"
        }
      ]
    },
    {
      "broker": 5,
      "logDirs": [
        {
          "partitions": [],
          "error": null,
          "logDir": "/var/lib/kafka/data-1/kafka-log5"
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
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-0/kafka-log5"
        },
        {
          "partitions": [],
          "error": null,
          "logDir": "/var/lib/kafka/data-2/kafka-log5"
        }
      ]
    },
    {
      "broker": 3,
      "logDirs": [
        {
          "partitions": [
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
            }
          ],
          "error": null,
          "logDir": "/var/lib/kafka/data-0/kafka-log3"
        },
        {
          "partitions": [],
          "error": null,
          "logDir": "/var/lib/kafka/data-2/kafka-log3"
        },
        {
          "partitions": [],
          "error": null,
          "logDir": "/var/lib/kafka/data-1/kafka-log3"
        }
      ]
    }
  ],
  "version": 1
}
```
As shown in the output, the data has been moved from volumes 1 and 2 of all the brokers, which no longer contain any partition replicas.
To remove volume 1 and volume 2 from all the brokers, we need to update the configuration for the node pools to specify only volume 0 and then apply the changes.
```yaml
# ...
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: broker
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[3-5]"
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
        kraftMetadata: shared
        deleteClaim: false
# ...
```

Checking the PVCs, we see that they are not deleted.
```shell
 kubectl get pvc -n myproject
```

```yaml
NAME                             STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
data-0-my-cluster-broker-3       Bound    pvc-d3027150-36ef-48f5-9ee1-ee4bdad93c0c   100Gi      RWO            standard       63m
data-0-my-cluster-broker-4       Bound    pvc-12792aeb-83c5-47a9-a7e3-cfe9a3472fee   100Gi      RWO            standard       63m
data-0-my-cluster-broker-5       Bound    pvc-35c1b8ad-d4cc-4785-848a-670dc62035c3   100Gi      RWO            standard       63m
data-0-my-cluster-controller-0   Bound    pvc-7719eb5d-59d1-4e47-9fed-7ffeff566d1f   100Gi      RWO            standard       63m
data-0-my-cluster-controller-1   Bound    pvc-b1bccbe2-cd0b-4ae6-a6d7-54f2dd9728bf   100Gi      RWO            standard       63m
data-0-my-cluster-controller-2   Bound    pvc-a7b8306a-f9c3-4e62-9201-f9cb189fc3f8   100Gi      RWO            standard       63m
data-1-my-cluster-broker-3       Bound    pvc-0aa2f480-6cb8-4247-b0f7-322bb95b0b2a   100Gi      RWO            standard       63m
data-1-my-cluster-broker-4       Bound    pvc-870755ad-3ee2-4c7a-8c03-c20502014548   100Gi      RWO            standard       63m
data-1-my-cluster-broker-5       Bound    pvc-0a291b63-955b-40db-98e7-eef25224c78a   100Gi      RWO            standard       63m
data-2-my-cluster-broker-4       Bound    pvc-3d79414f-e227-4555-8589-41893d433d8d   100Gi      RWO            standard       63m
data-2-my-cluster-broker-5       Bound    pvc-0c126dc5-863f-4e2a-96ae-1a4fef9d8839   100Gi      RWO            standard       63m
```

It is because they are not deleted by default, and you need to remove them yourself. You can delete the PVCs using the following command.
```shell
kubectl delete pvc data-1-my-cluster-broker-3  -n myproject 
```

You can remove the other PVCs in the same way.

#### What's missing?

After all replicas are moved from the specified disk, it is very much possible that some new  partitions replicas gets assigned to them when a new topic is created and also the disk may still be used by Cruise Control during the rebalance, so make sure that you delete the  unrequired volumes once they are cleaned before performing new operations like rebalancing or creating topics.

#### Additional notes

1. This feature only works if JBOD storage is enabled and multiple disks are used, otherwise you will be prompted for not having enough volumes to move the data to.
2. The optimization proposal does not show the load before optimization, it only shows the load after optimization.

### What's next

We hope this blog post has provided you with a clear understanding of how you can use the `KafkaRebalance` custom resource in `remove-disks` mode to easily move the data between the JBOD disks.
If you encounter any issues or want to know more, refer to our documentation on [Using Cruise Control to reassign partitions on JBOD disks](https://strimzi.io/docs/operators/latest/deploying#proc-cruise-control-moving-data-str).