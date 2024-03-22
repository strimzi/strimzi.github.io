---
layout: post
title:  "Migrate your Strimzi-operated cluster from ZooKeeper to KRaft"
date: 2024-03-22
author: paolo_patierno
---

In the previous [blog post](https://strimzi.io/blog/2024/03/21/kraft-migration/) we explored how Apache ZooKeeper is used to store Apache Kafka clusters metadata and what are the current limitations.
The Apache Kafka community introduced the new KRaft protocol which allows you to overcome these limitations and store metadata in Kafka itself, taking into account that the ZooKeeper support will be removed soon.
For this reason, there is a need to migrate existing clusters from using ZooKeeper to KRaft for storing metadata.
We also covered the overall Kafka metadata migration procedure.
The migration procedure can be done without downtime, but it is not that straightforward because it requires manual configurations and several rolling updates.
The good news is that if your cluster is powered by Strimzi, this process is much easier and can be accomplished simply by annotating your `Kafka` resource.
In this blog post, we are going to show you how the Strimzi Cluster Operator provides a semi-automated process to run the migration easily, so that you don't need to worry about updating configurations and restarting cluster nodes.

<!--more-->

### Strimzi's migration support

If you are using the Strimzi operator 0.40.0 release to run your current ZooKeeper-based cluster on Kubernetes, the migration process is semi-automated.
It is managed by updating the `strimzi.io/kraft` annotation on the `Kafka` custom resource.
This allows the internal migration service to transition smoothly across the different phases.
The operator will apply the necessary configuration to the nodes and then initiate a rolling update.
It is also in charge of checking the migration status by looking at the metrics to make sure it was done successfully.

Before the Strimzi 0.40.0 release, the `strimzi.io/kraft` annotation on the `Kafka` custom resource was used to define a ZooKeeper-based cluster, by using the `disabled` value, or a KRaft-based cluster, by using the `enabled` value.

This is still used even in Strimzi 0.40.0.
But now it is possible to use two additional values for the `strimzi.io/kraft` annotation:

* `migration` to start the migration process
* `rollback` to revert the migration itself

During migration or rollback, the `enabled` and `disabled` values are used to finalize the procedure by ending with a cluster in KRaft mode or reverting to the ZooKeeper mode.

One of the main prerequisites for the migration is having the ZooKeeper-based cluster using the `KafkaNodePool` resource(s) to run the brokers.
If that is not the case for you, please refer to the [official Strimzi documentation](https://strimzi.io/docs/operators/latest/deploying#proc-migrating-clusters-node-pools-str) and this [series of blog posts](https://strimzi.io/blog/2023/08/14/kafka-node-pools-introduction/) focused on node pools.

Before starting the migration, the `Kafka` custom resource must have the `strimzi.io/node-pools: enabled` annotation to use node pools, as well as the `strimzi.io/kraft: disabled` annotation that defines a ZooKeeper-based cluster.

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

Before migrating, a deployed cluster generally has severals pods running for the Kafka brokers and ZooKeeper nodes.

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

#### Migrating from ZooKeeper to KRaft-based brokers

The initial migration step involves deploying a `KafkaNodePool` custom resource to provision the KRaft controllers. 
Then, you change the `strimzi.io/kraft` annotation on the `Kafka` custom resource from `disabled` to `migration` to initiate the process.

Here's a snippet of the `KafkaNodePool` custom resource needed to deploy and activate the KRaft controllers:

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

The corresponding `Kafka` custom resource is then updated to set the `strimzi.io/kraft` annotation to `migration`:

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

You can do that by annotating the custom resource.

```shell
kubectl annotate kafka my-cluster strimzi.io/kraft="migration" --overwrite
```

The annotation change triggers the Strimzi operator to run the following steps:

* Deploy the KRaft controllers with all the necessary connection details to ZooKeeper and the migration flag enabled.
* Configure the running brokers with the connection details to the KRaft controller quorum, with the migration flag enabled, and initiate a rolling update.
* During each reconciliation, monitor the migration status by checking the `kafka.controller:type=KafkaController,name=ZkMigrationState` metric. Update the `Kafka` custom resource to reflect this status through the `status.kafkaMetadataState` field.
* Once the migration is complete, reconfigure the brokers to disconnect from ZooKeeper, disable the migration flag, and initiate another rolling update.

As you can see, just applying one single annotation value has covered most of the phases in the migration procedure with the user doing practically nothing, just following what the operator is running for them.

While the migration is going on, you can see the cluster changing the metadata state during the migration process from `ZooKeeper` to `KRaftPostMigration`, and then waiting for the user to finalize it.

```shell
kubectl get kafka my-cluster -n kafka -w

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

In the `KRaftPostMigration` state, the cluster is still working in "dual-write" mode and the user can validate that everything is working fine before deciding to finalize the migration or rolling back to use ZooKeeper.
If the `Kafka` custom resource has the `inter.broker.protocol.version` and `log.message.format.version` parameters set in the `spec.kafka.config` section, and because they are not supported in KRaft, the operator reports warnings into the status (see `WARNINGS` column).
The user has to remove the parameters at the end of the process causing an additional rolling of the nodes.

In the `KRaftPostMigration` state, you have two options how you can continue:

* [Finalize the migration](#finalizing-the-migration) to have a full KRaft cluster.
* [Rollback the migration](#rolling-back-the-cluster-to-zookeeper) to retain using ZooKeeper.

#### Finalizing the migration

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

You can do that by annotating the custom resource.

```shell
kubectl annotate kafka my-cluster strimzi.io/kraft="enabled" --overwrite
```

The operator will configure the KRaft controllers without the ZooKeeper connection details, with the migration flag disabled, and roll them.
When both brokers and controllers are working in KRaft mode, the operator will delete all the resources related to ZooKeeper as well.
At this point, the user can delete the `.spec.zookeeper` section from the `Kafka` custom resource because it is not needed anymore.

During the finalization, the cluster metadata state moves to the final `KRaft` state.

```shell
NAME         DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   METADATA STATE   WARNINGS
...
my-cluster   3                        3                     True    KRaftPostMigration   True
my-cluster   3                        3                     True    PreKRaft             True
my-cluster   3                        3                     True    KRaft                True
my-cluster                                                  True    KRaft                True
my-cluster                                                  True    KRaft                
```

As you can see, just a couple of changes on the `strimzi.io/kraft` annotation make the migration really straightforward.

![Strimzi KRaft migration](/assets/images/posts/2024-03-22-strimzi-kraft-migration-01.png)

#### Rolling back the cluster to ZooKeeper

If the migration process is still not finalized, with the KRaft controllers remaining connected to ZooKeeper, it is still possible to initiate a rollback.
By applying the `rollback` value on the `strimzi.io/kraft` annotation, the operator reconfigures the brokers with the connection details to ZooKeeper again and rolls them.

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

You can do that by annotating the custom resource.

```shell
kubectl annotate kafka my-cluster strimzi.io/kraft="rollback" --overwrite
```

Following the rollback, the cluster metadata state moves back to `KRaftDualWriting`, waiting for the user to finalize the process.

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

You can do that by annotating the custom resource.

```shell
kubectl annotate kafka my-cluster strimzi.io/kraft="disabled" --overwrite
```

The annotation change triggers the Strimzi operator to run the following steps for you:

* Automatically delete the `/controller` znode on ZooKeeper to enable brokers to elect a new controller from among themselves, replacing the previous KRaft controller.
* Reconfigure brokers to remove connection details to the KRaft controller quorum and revert to using ZooKeeper. Then, initiate a rolling update.

Finally, the cluster metadata state returns to `ZooKeeper`.

```shell
NAME         DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   METADATA STATE   WARNINGS
...
my-cluster   3                        3                             KRaftDualWriting     
my-cluster   3                        3                             KRaftDualWriting     
my-cluster   3                        3                     True    ZooKeeper            True
```

![Strimzi KRaft migration rollback](/assets/images/posts/2024-03-22-strimzi-kraft-migration-rollback-02.png)

### Conclusion

While the manual migration process could be considered long and complex if your cluster is running on bare-metal or virtual machines, it is very easy if the cluster is running on Kubernetes because of the Strimzi support for it.
The Strimzi operator provides a semi-automated process which needs just a few manual steps to update an annotation to migrate your cluster.
Together with a GitOps approach you could easily migrate multiple clusters at the time.

Let us know your experience with the migration of your cluster with Strimzi.
Your feedback is very welcome!