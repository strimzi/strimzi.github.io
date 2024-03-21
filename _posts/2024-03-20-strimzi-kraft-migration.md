---
layout: post
title:  "Migrate your Strimzi-operated cluster from ZooKeeper to KRaft"
date: 2024-03-20
author: paolo_patierno
---

In the previous [blog post](TBD) we explored how Apache ZooKeeper is used to store Apache Kafka clusters metadata and what are the current limitations.
We introduced the new KRaft protocol which allows to overcome such limitations and store metadata in Kafka itself, taking into account that the ZooKeeper support will be removed soon.
For this reason, there is the need to migrate existing clusters from using ZooKeeper to KRaft for storing metadata.
We also covered the overall procedure to do that.
The Kafka metadata migration procedure can be done without downtime, but it is not that straightforward because it requires manual configurations and several rolling updates.
The good news is that, if your cluster is powered by Strimzi, this process is much easier, and can be driven by simply annotating your Kafka resource.
In this blog post, we are going to show you how the Strimzi cluster operator provides a semi-automated process to run the migration easily, so that you don't need to worry about updating configurations and restarting cluster nodes.

<!--more-->

### Strimzi migration support

If you are using the Strimzi operator to run your current ZooKeeper-based cluster on Kubernetes, the migration process is semi-automated.
What you have to do is just updating the `strimzi.io/kraft` annotation on the `Kafka` cluster resource in order to allow the internal migration service to move across the different phases.
The operator is going to apply the needed configuration to the nodes and roll them.
It is also in charge of checking the migration status looking at the metrics for you to make sure it was done successfully.

Before latest Strimzi 0.40.0 release, the `strimzi.io/kraft` annotation on the `Kafka` custom resource was used to define a ZooKeeper-based cluster, by using the `disabled` value, or a KRaft-based cluster, by using the `enabled` value.

It is now possible to use two more values for the `strimzi.io/kraft` annotation: 

* `migration` to start the migration process;
* `rollback` to revert the migration itself;

During migration or rollback, the `enabled` and `disabled` values are still used to finalize the procedure by ending with a cluster in KRaft mode or keeping the ZooKeeper mode.

One of the main prerequisites for the migration is about having the ZooKeeper-based cluster using the `KafkaNodePool` resource(s) to run the brokers.
If that is not the case for you, please refer to the official Strimzi documentation [here](https://strimzi.io/docs/operators/latest/deploying#proc-migrating-clusters-node-pools-str) and this [series of blog posts](https://strimzi.io/blog/2023/08/14/kafka-node-pools-introduction/) focused on node pools.

Before starting the migration, the `Kafka` custom resource has to have the `strimzi.io/node-pools: enabled` annotation to use node pools together with the `strimzi.io/kraft: disabled` which defines a ZooKeeper-based cluster.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/kraft: disabled # states that the cluster is ZooKeeper-based
    strimzi.io/node-pools: enabled
# ...
```

Using the Unidirectional Topic Operator and a Kafka version greater or equal 3.7.0 are important prerequisites as well.

The deployed cluster has severals pods running for the Kafka brokers and ZooKeeper nodes.

```shell
NAME                                          READY   STATUS    RESTARTS   AGE
my-cluster-entity-operator-555785d699-kksrs   2/2     Running   0          17m
my-cluster-kafka-0                            1/1     Running   0          18m
my-cluster-kafka-1                            1/1     Running   0          18m
my-cluster-kafka-2                            1/1     Running   0          18m
my-cluster-zookeeper-0                        1/1     Running   0          20m
my-cluster-zookeeper-1                        1/1     Running   0          20m
my-cluster-zookeeper-2                        1/1     Running   0          20m
strimzi-cluster-operator-7ddf57685d-245pd     1/1     Running   0          17m
```

#### From ZooKeeper to full KRaft based brokers

The first step is to deploy a `KafkaNodePool` custom resource which is used to provision the KRaft controllers and then changing the `strimzi.io/kraft` annotation from `disabled` to `migration` to trigger the process.

Following a snippet of a `KafkaNodePool` custom resource to be deployed for getting the KRaft controllers running.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: controller
  labels:
    strimzi.io/cluster: my-cluster
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
        deleteClaim: false
```

The corresponding `Kafka` custom resource is then updated in regards to the `strimzi.io/kraft` set to `migration`. 

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/kraft: migration # updated from "disabled" to "migration" to trigger the migration process
    strimzi.io/node-pools: enabled
# ...
```

The annotation change triggers the Strimzi operator to run the following steps:

* deploy the KRaft controllers, which are configured with all the connection details to ZooKeeper and with the migration flag enabled;
* configure the running brokers with the connection details to the KRaft controller quorum, the migration flag enabled and roll them;
* on each reconciliation, check the status of the migration and update the `Kafka` custom resource to provide such status to the user through the `status.kafkaMetadataState` field;
* when the migration is done, reconfigure brokers to be not connected to ZooKeeper anymore, with the migration flag disabled, and roll them again;

As you can see, just applying one single annotation value has covered most of the phases in the migration procedure with the user doing actually nothing but following what the operator is running for them.

While the migration is going on, you can see the cluster changing the metadata state during the migration process from `ZooKeeper` to `KRaftPostMigration`, and then waiting for the user to finalize it.

```shell
NAME         DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   METADATA STATE   WARNINGS
my-cluster   3                        3                     True    ZooKeeper        
my-cluster   3                        3                     True    ZooKeeper        
my-cluster   3                        3                     True    ZooKeeper        True
my-cluster   3                        3                             ZooKeeper        True
my-cluster   3                        3                             ZooKeeper        True
my-cluster   3                        3                             ZooKeeper        
my-cluster   3                        3                             ZooKeeper        
my-cluster   3                        3                             ZooKeeper        
my-cluster   3                        3                     True    KRaftMigration   
my-cluster   3                        3                     True    KRaftDualWriting   
my-cluster   3                        3                     True    KRaftPostMigration   
my-cluster   3                        3                     True    KRaftPostMigration   True
```

In this status, the cluster is still working in "dual-write" mode and the user can validate that everything is working fine before deciding to finalize the migration or rolling back to use ZooKeeper.

#### Migration finalization

At this point, the user can finalize the migration by changing the `strimzi.io/kraft` annotation to `enabled`.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/kraft: enabled # updated from "migration" to "enabled" to finalize the migration process
    strimzi.io/node-pools: enabled
# ...
```

The operator will configure the KRaft controllers without the ZooKeeper connection details, with the migration flag disabled and roll them.
When both brokers and controllers are working in KRaft mode, the operator will delete all the resources related to ZooKeeper as well.
At this point, the user can delete the `.spec.zookeeper` section from the `Kafka` custom resource because it is not needed anymore.

During the finalization, the cluster metadata state moves to the final `KRaft`.

```shell
NAME         DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   METADATA STATE   WARNINGS
...
my-cluster   3                        3                     True    KRaftPostMigration   True
my-cluster   3                        3                     True    PreKRaft             True
my-cluster   3                        3                     True    KRaft                True
my-cluster                                                  True    KRaft                True
my-cluster                                                  True    KRaft                
```

As you can see, just a couple of changes on the `strimzi.io/kraft` annotation make the migration really straight forward.

#### Rollback support

When the migration is not finalized yet, so when the KRaft controllers are still connected to ZooKeeper, it is still possible to rollback.
By applying the `rollback` value on the `strimzi.io/kraft` annotation, the operator reconfigures the brokers with the connection details to ZooKeeper again and roll them.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/kraft: rollback # updated from "migration" to "rollback" to revert the migration process
    strimzi.io/node-pools: enabled
# ...
```    

Because of the rollback, the cluster metadata state moves back to `KRaftDualWriting`, waiting for the user to finalize the revert.

```shell
NAME         DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   METADATA STATE   WARNINGS
...
my-cluster   3                        3                             ZooKeeper        True
my-cluster   3                        3                     True    KRaftMigration   
my-cluster   3                        3                     True    KRaftDualWriting   
my-cluster   3                        3                     True    KRaftPostMigration   
my-cluster   3                        3                     True    KRaftPostMigration   True
my-cluster   3                        3                     True    KRaftPostMigration   True
my-cluster   3                        3                     True    KRaftDualWriting     
my-cluster   3                        3                     True    KRaftDualWriting     True
my-cluster   3                        3                             KRaftDualWriting     
```

After that, you have to delete the `KafkaNodePool` hosting the KRaft controllers and then apply the `disabled` value annotation.

The annotation change triggers the Strimzi operator to run the following steps for you:

* automatically delete the `/controller` znode on ZooKeeper to allow the brokers to elect the new controller among them in place of the previous KRaft controller;
* reconfigure brokers without connection details to the KRaft controller quorum anymore but using ZooKeeper again and roll them;

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/kraft: disabled # updated from "rollback" to "disabled" to finalize the rollback to ZooKeeper
    strimzi.io/node-pools: enabled
# ...
```

Finally, the cluster metadata state comes back to be `ZooKeeper`.

```shell
NAME         DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   METADATA STATE   WARNINGS
...
my-cluster   3                        3                             KRaftDualWriting     
my-cluster   3                        3                             KRaftDualWriting     
my-cluster   3                        3                     True    ZooKeeper            True
```

### Conclusion

While the manual migration process could be considered long and complex if your cluster is running on bare-metal or virtual machines, it is very easy if the cluster is running on Kubernetes instead because of the Strimzi support for it.
The Strimzi operator provides you a semi-automated process which needs just a few manual steps to update an annotation to migrate your cluster.
Together with a GitOps approach you could easily migrate multiple cluster at the time.

Let us know your experience with the migration of your cluster with Strimzi.
Your feedback is very welcome!