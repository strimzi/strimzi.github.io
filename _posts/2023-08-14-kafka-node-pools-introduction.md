---
layout: post
title: "Kafka Node Pools: Introduction"
date: 2023-08-14
author: jakub_scholz
---

Kafka Node Pools are one of the new features in Strimzi 0.36.
Node Pools represent different groups of Kafka nodes (brokers).
All nodes from a given pool share the same configuration.
But their configuration might differ from nodes belonging to other node pools.
In this blog post series, we will look closer at the node pools, explain how to use them, and also show some of the situations where they are useful.

<!--more-->

_This post is part of a series about Kafka node pools.
Other posts include:_

* _Part 1 - Introduction (this post)_
* _[Part 2 - Node ID Management](https://strimzi.io/blog/2023/08/23/kafka-node-pools-node-id-management/)_
* _[Part 3 - Storage & Scheduling](https://strimzi.io/blog/2023/08/28/kafka-node-pools-storage-and-scheduling/)_
* _[Part 4 - Supporting KRaft (ZooKeeper-less Apache Kafka)](https://strimzi.io/blog/2023/09/11/kafka-node-pools-supporting-kraft/)_
* _[Part 5 - What's next? (this post)](https://strimzi.io/blog/2023/09/11/kafka-node-pools-whats-next/)_

### `KafkaNodePools` feature gate

Support for Kafka Node Pools in Strimzi 0.36 is behind an _alpha-level_ Feature Gate.
What does that mean?

First of all, it means that node pool support is disabled by default.
You have to enable the `KafkaNodePools` feature gate if you want to try it.
The _alpha-level_ feature gate also suggests that this is a brand-new feature that:
* Is in the process of being developed and tested.
  There is a possibility that certain components might still be under construction or could contain bugs.
* Is being actively assessed whether this feature aligns with its intended purposes and provides a positive user experience.
* Is an evolving feature.
  It could experience modifications in upcoming releases or even be removed. 
  Backward compatibility with prior versions of the feature gate might not be guaranteed.

All of the above means that you should probably not use node pools in your production environment just yet.
But at the same time, it offers a preview of how Strimzi might operate in the future and shows some new features that will be possible.
So we encourage you to try it in some test environment and share your feedback, bugs or improvement ideas with us.

The current plan is that if everything goes well, the `KafkaNodePools` feature gate will move to the _beta_ phase and be enabled by default in Strimzi 0.39.
But the plan might of course change depending on how well it works and on the feedback we receive.

If you want to learn more about feature gates in Strimzi, you can learn more about them in [our documentation](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#ref-operator-cluster-feature-gate-releases-str).
You can also find there a full list of the [feature gates Strimzi currently supports](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#ref-operator-cluster-feature-gates-str).

### Enabling node pools

To enable node pools, you must enable the `KafkaNodePool` feature gate.
You can do that by editing the Strimzi Cluster Operator `Deployment` configuration and adding `+KafkaNodePools` to the `STRIMZI_FEATURE_GATES` environment variable:

```yaml
env:
  # ...
  - name: STRIMZI_FEATURE_GATES
    value: +KafkaNodePools
```

You can find more details about enabling the feature gates in [our documentation](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#ref-operator-cluster-feature-gates-str).

Enabling `+KafkaNodePools` does not have any impact on your existing Kafka clusters.
Kafka node pools are used exclusively with Kafka clusters that include the annotation `strimzi.io/node-pools: enabled` in the `Kafka` custom resource.
After enabling the feature gate and applying the `Kafka` resource with this annotation, the operator searches for `KafkaNodePool` custom resources to be able to use node pools with the respective Kafka cluster.
Kafka pods are not created based on the `Kafka` resource, but based on the `KafkaNodePool` resources.

### Configuring node pools

Node pools are configured using a new custom resource named `KafkaNodePool`.
It currently supports 6 different configuration options:
* Number of replicas in that pool
* Role(s) of the nodes in this pool
* The storage configuration
* Resource requirements (e.g. memory and CPU)
* JVM configuration options
* Template for customizing the resources belonging to this pool, such as pods or containers

These are the options which can be different between various node pools.
All the other options are inherited from the `Kafka` custom resource.
These include the following properties:
* Apache Kafka version
* Apache Kafka configuration
* Listener configuration
* Authorization configuration
* And more ...

In the future, it is possible that some additional options will be added to the `KafkaNodePool` resource as well.

Three of the configuration options in the `KafkaNodePool` resource are required and always have to be configured:
1. The number of replicas that determines how many Kafka nodes the node pool creates.
2. Storage used by the nodes in the node pool.
3. The roles of the nodes in the node pool.
   In a ZooKeeper-based Apache Kafka cluster, the role always has to be set to `broker`.
   In KRaft mode, the roles can be either `broker` or `controller`.
   And you can also mix them to create combined nodes with both the `broker` and `controller` nodes.

The other three configuration options in the `KafkaNodePool` resource - resource requirements, JVM configuration options, and template - are optional.
If you do not set them in the `KafkaNodePool` resource but set them in the `Kafka` resource, the Kafka nodes will automatically inherit them.
So, for example, if you want to use the same JVM configuration for all your node pools, you can configure it only once in the `Kafka` resource and do not have to configure it in every `KafkaNodePool` resource.
If these options are not set in the `KafkaNodePool` but not configured in `Kafka` resource either, they will use the default values.

Every node pool has to also include the `strimzi.io/cluster` label and have it set to the name of the Kafka cluster (name of the `Kafka` custom resource) to which it belongs.
That way the operator knows to which cluster it belongs and configures the Kubernetes pods to correctly connect with each other and form the Kafka cluster.

And what about the number of replicas and storage configuration in the `Kafka` custom resource?
These options are not needed anymore since they are configured by the `KafkaNodePool` resources.
However, while the node pools feature gate is at the _alpha_ phase, these fields are still mandatory in the `Kafka` resource.
But they will be completely ignored when node pools are used.
That way we make sure that the schema validation of the `Kafka` custom resources works well for the majority of Strimzi users who will have the feature gate disabled.
Once the node pools move to beta and are enabled by default, these fields will be made optional in the CRD schema so they will not be required anymore.

#### Examples

Let's look at an example.
First, the `KafkaNodePool` resources:

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
        size: 200Gi
        deleteClaim: false
  resources:
    requests:
      memory: 16Gi
      cpu: 1000m
    limits:
      memory: 16Gi
      cpu: 2000m
  jvmOptions:
    -Xms: 4096m
    -Xmx: 4096m
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
        size: 1Ti
        deleteClaim: false
  resources:
    requests:
      memory: 32Gi
      cpu: 2000m
    limits:
      memory: 32Gi
      cpu: 4000m
  jvmOptions:
    -Xms: 8192m
    -Xmx: 8192m
```

Above, you can see two `KafkaNodePools` named `pool-a` and `pool-b`.
Each of them has a slightly different configuration.
The nodes in `pool-b` are bigger then in `pool-a`, have more storage, and more memory used for the Java heap.
Both node pools have the `strimzi.io/cluster` label pointing to a Kafka cluster named `my-cluster`.
So we need to have a `Kafka` custom resource named `my-cluster` as well:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/node-pools: enabled
spec:
  kafka:
    version: 3.5.1
    # The replicas field is required by the Kafka CRD schema while the KafkaNodePools feature gate is in alpha phase.
    # But it will be ignored when Kafka Node Pools are used
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
      inter.broker.protocol.version: "3.5"
    # The storage field is required by the Kafka CRD schema while the KafkaNodePools feature gate is in alpha phase.
    # But it will be ignored when Kafka Node Pools are used
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

Notice that it has the `strimzi.io/node-pools: enabled` annotation to enable the node pools.
And also the `.spec.kafka.replicas` and `.spec.kafka.storage` properties, which are ignored but still have to be present.

Additional examples can be also found [in the `examples` folder in our GitHub](https://github.com/strimzi/strimzi-kafka-operator/tree/main/examples/kafka/nodepools).

#### Assigning node IDs and pod names

When you deploy the Kafka cluster with node pools, the Strimzi Cluster Operator creates the pods for each node pool.
And it will automatically assign the node IDs to the different nodes.
So when you list the pods, you should see something similar to this:

```
$ kubectl get pods
NAME                                          READY   STATUS    RESTARTS   AGE
my-cluster-entity-operator-6784f64f9c-55pfh   2/2     Running   0          2m45s
my-cluster-pool-a-0                           1/1     Running   0          3m10s
my-cluster-pool-a-1                           1/1     Running   0          3m10s
my-cluster-pool-a-2                           1/1     Running   0          3m10s
my-cluster-pool-b-3                           1/1     Running   0          3m10s
my-cluster-pool-b-4                           1/1     Running   0          3m10s
my-cluster-pool-b-5                           1/1     Running   0          3m10s
my-cluster-zookeeper-0                        1/1     Running   0          4m33s
my-cluster-zookeeper-1                        1/1     Running   0          4m33s
my-cluster-zookeeper-2                        1/1     Running   0          4m33s
strimzi-cluster-operator-58c8cf6469-f25wj     1/1     Running   0          4m21s
```

You can see that Kafka pods are named based on the name of the Kafka cluster (`my-cluster`), name of the pool (`pool-a`) and the node ID.
For example `my-cluster-pool-1`.
As you can see, the 3 nodes in the `pool-a` got assigned the node IDs 0, 1, and 2.
And the 3 nodes in the `pool-b` got assigned the node IDs 3, 4, and 5.
In the next part of this blog post series, we will look at some tricks to control which IDs are assigned to which pool.

#### Checking the status of the custom resources

Once the cluster is deployed, you can also check the `.status` fields of the custom resources.
In the `KafkaNodePool` resource status, you can see among other things the node IDs assigned to the nodes from pool:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-b
  labels:
    strimzi.io/cluster: my-cluster
spec:
  # ...
status:
  # ...
  nodeIds:
    - 3
    - 4
    - 5
```

It also contains some other information, such as the Kafka cluster ID.

In the status of the `Kafka` resource, you can also see the list of node pools that belong to the Kafka cluster:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/node-pools: enabled
spec:
  # ...
status:
  # ...
  kafkaNodePools:
    - name: pool-a
    - name: pool-b
  # ...
```

#### Scaling node pools

Each node pool can be scaled independently.
You can do it by changing the `.spec.replicas` number in the `KafkaNodePool` resource.
But the `KafkaNodePools` resource also supports the _scale sub-resource_.
So you can scale them using the `kubectl scale` command as well:

```
kubectl scale kafkanodepool pool-a --replicas=5
```

When scaling up, the operator will by default assign the lowest available node IDs to the new pods.
So after scaling our example `pool-a` to 5 replicas, the cluster looks like this:

```
$ kubectl get pods
NAME                                          READY   STATUS    RESTARTS   AGE
my-cluster-entity-operator-6784f64f9c-55pfh   2/2     Running   0          19m
my-cluster-pool-a-0                           1/1     Running   0          19m
my-cluster-pool-a-1                           1/1     Running   0          19m
my-cluster-pool-a-2                           1/1     Running   0          19m
my-cluster-pool-a-6                           1/1     Running   0          68s
my-cluster-pool-a-7                           1/1     Running   0          68s
my-cluster-pool-b-3                           1/1     Running   0          19m
my-cluster-pool-b-4                           1/1     Running   0          19m
my-cluster-pool-b-5                           1/1     Running   0          19m
my-cluster-zookeeper-0                        1/1     Running   0          20m
my-cluster-zookeeper-1                        1/1     Running   0          20m
my-cluster-zookeeper-2                        1/1     Running   0          20m
strimzi-cluster-operator-58c8cf6469-f25wj     1/1     Running   0          20m
```

As you can see, the new Kafka nodes were assigned the node IDs 6 and 7.
And when scaling down, the operator will by default remove the highest used node IDs first.
So after scaling down `pool-b` to 1 replica, the node IDs 4 and 5 are removed and the pods look like this:

```
$ kubectl get pods
NAME                                          READY   STATUS    RESTARTS   AGE
my-cluster-entity-operator-6784f64f9c-55pfh   2/2     Running   0          21m
my-cluster-pool-a-0                           1/1     Running   0          21m
my-cluster-pool-a-1                           1/1     Running   0          21m
my-cluster-pool-a-2                           1/1     Running   0          21m
my-cluster-pool-a-6                           1/1     Running   0          3m13s
my-cluster-pool-a-7                           1/1     Running   0          3m13s
my-cluster-pool-b-3                           1/1     Running   0          21m
my-cluster-zookeeper-0                        1/1     Running   0          23m
my-cluster-zookeeper-1                        1/1     Running   0          23m
my-cluster-zookeeper-2                        1/1     Running   0          23m
strimzi-cluster-operator-58c8cf6469-f25wj     1/1     Running   0          22m
```

### Migrating existing clusters to Node Pools

In Strimzi, it is also paramount importance for us to support our existing users and their existing clusters.
So you can also migrate existing Kafka clusters to use node pools.
We will not go into the details of this in this blog post series.
But the migration process is described in [our documentation](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#proc-migrating-clusters-node-pools-str).

### What's next?

Hopefully, this blog post gave you a quick introduction to what node pools are and how they work.

In upcoming posts, we will look at some practical uses of node pools and show how they can resolve certain problems.
Stay tuned for the next installment. 
In the meantime, we invite you to try out node pools for yourself and share your experience with us. 
