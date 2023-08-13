---
layout: post
title: "Kafka Node Pools: Introduction"
date: 2023-08-13
author: jakub_scholz
---

Kafka Node Pools are one of the new features in Strimzi 0.36.
Node Pools represent different groups of Kafka nodes (brokers).
All nodes from a given pool share the same configuration.
But their configuration might differ from nodes belonging to other node pools.
In this blog post series, we will look closer at the node pools, explain how to use them, and also show some of the situations where they are useful.

<!--more-->

Support for Kafka Node Pools in Strimzi 0.36 is behind an _alpha-level_ Feature Gate.
What does that mean?

### `KafkaNodePools` feature gate

First of all, it means that the Node Pool support is disabled by default and you have to enable it first if you want to try it.
It also suggests that this is a brand-new feature that:
* It might be still under development and testing.
  It might contain bugs or some parts of it might still be missing.
* We might be still evaluating it this is a feature we want to have, whether it fulfills its goals, and provides good user experience.
* It might still change in future releases or even be removed.
  It might not maintain a backwards compatibility with the previous versions of the feature gate.

All of the above means that you should probably not use Node Pools in your production environment just yet.
But at the same time, it offers a preview of how Strimzi might look like in few months and shows some new features that will be possible.
So we encourage you to try it in some test environment and share your feedback, bugs or improvement ideas with us.

The current plan is that if everything goes well, the `KafkaNodePools` feature gate will move to the _beta_ phase and be enabled by default in Strimzi 0.39.
But the plan might of course change depending on how well it works and on the feedback we receive.

If you want to learn more about feature gates in Strimzi, you can learn more about them in [our documentation](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#ref-operator-cluster-feature-gate-releases-str).
You can also find there a full list of the [feature gates Strimzi currently supports](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#ref-operator-cluster-feature-gates-str).

### Enabling Node Pools

To enable the Node Pools, you have to enable the `KafkaNodePool` feature gate.
You can do that by editing the Strimzi Cluster Operator Deployment and adding `+KafkaNodePools` to the `STRIMZI_FEATURE_GATES` environment variable:

```yaml
env:
  # ...
  - name: STRIMZI_FEATURE_GATES
    value: +KafkaNodePools
```

You can find more details about enabling the feature gates in [our documentation](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#ref-operator-cluster-feature-gates-str).

Enabling the `+KafkaNodePools` does not have any impact on your existing Kafka clusters.
The Kafka Node Pools will be used only for the Kafka clusters with the annotation `strimzi.io/node-pools: enabled` on the `Kafka` custom resource.
Once the feature gate is enabled and the `Kafka` resource has this annotation, the operator will look for the `KafkaNodePool` custom resources will use Node Pools for this Kafka cluster.
For such resource, no Kafka Pods will be created based on the `Kafka` resource itself but only based on the `KafkaNodePool` resources.

### Configuring Node Pools

The Node Pools are configured using a new custom resource named `KafkaNodePool`.
It currently supports 6 different configuration options:
* Number of replicas
* Role(s) of the nodes in this pool
* The storage configuration
* Resource requirements
* JVM configuration options
* Template for customizing the resources belonging to this pool such for example Pods or containers

These are the options which can be different between various node pools.
Each node pool can configure them differently.

All the other options are inherited from the `Kafka` custom resource.
These includes:
* Apache Kafka version
* Apache Kafka configuration
* Listener configuration
* Authorization configuration
* And more ...

In the future, it is possible that some additional options will be added to the `KafkaNodePool` resource as well.

Three of the configuration options in the `KafkaNodePool` resource are required and have to be always configured.

1. The number of replicas which defines how many Kafka nodes will this node pool create
2. Storage used by the nodes in given node pool
3. The role(s) of the nodes in given node pool.
   In a ZooKeeper-based Apache Kafka cluster, the role always has to be set to `broker`.
   In KRaft mode, the roles can be either `broker` or `controller`.
   And you can also mix them to create combined nodes with both the `broker` and `controller` nodes.

The other three configuration options in the `KafkaNodePool` resource - resource requirements, JVM configuration options, and template - are optional.
If you do not set them in the `KafkaNodePool` resource but set them in the `Kafka` resource, the Kafka nodes will automatically inherit them.
So if you for example want to use the same JVM configuration for all your node pools, you can configure it only once in the `Kafka` resource and do not have to configure it in every `KafkaNodePool` resource.
If these options are not set in the `KafkaNodePool` but not configured in `Kafka` resource either, they will use the default values.

Every Node Pool has to also include the `strimzi.io/cluster` label and have it set to the name of the Kafka cluster (name of the `Kafka` custom resource) to which it belongs.
That way the operator knows to which cluster it belongs and configures the Kubernetes Pods to correctly connect with each other and form the Kafka cluster.

And what about the number of replicas and storage configuration in the `Kafka` custom resource?
These options are not needed anymore since they are configured by the `KafkaNodePool` resources.
While the Node Pools are an _alpha_ feature gate, these fields are still mandatory in the `Kafka` resource.
But they will be completely ignored when node pools are used.
That way we make sure that the schema validation of the `Kafka` custom resources works well for the majority of Strimzi users who will have the feature gate disabled.
Once the node pools move to beta and will be enabled by default, these fields will be made optional and it will not be required to set them anymore.

#### Examples

Let's look at some example.
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
And also the `.spec.kafka.replicas` and `.spec.kafka.storage` fields which will be ignored, but still have to be there.

Additional examples can be also found [in the `examples` folder in our GitHub](https://github.com/strimzi/strimzi-kafka-operator/tree/main/examples/kafka/nodepools).

#### Node IDs and Pod names

When you deploy the Kafka cluster with Node Pools, the Strimzi Cluster Operator will create the Pods for each Node Pool.
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
In the next part of this blog post series, we will look at some tricks how you can control which IDs are assigned to which pool.

#### Status of the custom resources

Once the cluster is deployed, you can also check the `.status` fields of the custom resources.
In the `KafkaNodePool` resource status, you can see among other things the node IDs assigned to the nodes from pool:

```yaml
  status:
    # ...
    nodeIds:
      - 3
      - 4
      - 5
```

It also contains some other information, such as the Kafka cluster ID.

In the status of the `Kafka` resource, you can also see the list of Node Pools which belong to the Kafka cluster:

```yaml
  status:
    # ...
    kafkaNodePools:
      - name: pool-a
      - name: pool-b
```

#### Scaling Node Pools

Each node pool can be scaled independently.
You can do it by changing the `.spec.replicas` number in the `KafkaNodePool` resource.
But the `KafkaNodePools` also support the _scale sub-resource_.
So you can scale them using the `kubectl scale` command as well:

```
kubectl scale kafkanodepool pool-a --replicas=5
```

When scaling up, the operator will by default assign the lowest available node IDs to the new pods.
So after scaling the `pool-a` to 5 replicas, the cluster will look like this:

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
So after scaling down the `pool-b` to 1 replica, the node IDs 4 and 5 will be removed and the pods will look like this:

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

In Strimzi, it is also important for us to support our existing users and their clusters which already exist.
So you can also migrate existing Kafka clusters to use Node Pools.
We will not go into a detail of this in this blog post series.
But the migration process is described in [our documentation](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#proc-migrating-clusters-node-pools-str).

### What's next?

Hopefully, this blog post gave you a quick introduction to what Node Pools are and how they work.
In the next parts of this blog post series, we will look at some of the use-cases where they are useful and show some example problems that you can solve easily with Node Pools.
Stay tuned for the next blog post.