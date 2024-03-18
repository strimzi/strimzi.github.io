---
layout: post
title:  "From ZooKeeper to KRaft: let's automate the migration with Strimzi"
date: 2024-03-22
author: paolo_patierno
---

The Apache Kafka project has been using [Apache ZooKeeper](https://zookeeper.apache.org/) since its inception to store metadata.
Registered brokers, the current controller and topics' configuration are just a few of the data that ZooKeeper stores for supporting a running Kafka cluster.
Using a dedicated and centralized system for maintaining configuration data sounded the right approach at that time and ZooKeeper has been doing its work for long.
But taking care of an additional component alongside your Kafka cluster is not that simple.
Also, ZooKeeper has started to be a limitation for better scaling in terms of topics' partitions.
For these and more other reasons, the Apache Kafka community opened the "famous" [KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum) in late 2019 and started to work on the ZooKeeper removal.

<!--more-->

### What is "wrong" with ZooKeeper?

As already mentioned, Kafka has been using ZooKeeper as its metadata management system for several functions:

* **Cluster membership**: each broker, joining the Kafka cluster, registers itself with a temporary znode on ZooKeeper;
* **Controller election**: when a broker starts, it tries to take the "controller" role by creating the ephemeral `/controller` znode on ZooKeeper. If it already exists, it states what is the broker in the cluster having such a role and what is its epoch;
* **Topics configuration**: all the topics' configuration parameters are stored in ZooKeeper together with information like the number of partitions and on which brokers the replicas are hosted;
* **Access Control Lists (ACLs)**: when a client connects to the cluster, it could be authenticated and authorized to read or write on several topics based on the ACLs stored in ZooKeeper;
* **Quotas**: brokers can limit resources used by clients in terms of network bandwidth and CPU utilization via quotas stored in ZooKeeper;

By using the `zookeeper-shell` tool, it is possible to connect to a ZooKeeper ensemble and show some of them.

The brokers within the cluster are listed under the `/brokers` znode and for each of them there are information about their endpoints.

```shell
ls /brokers/ids
[0, 1, 2]

get /brokers/ids/0
{"features":{},"listener_security_protocol_map":{"CONTROLPLANE-9090":"SSL","REPLICATION-9091":"SSL","PLAIN-9092":"PLAINTEXT","TLS-9093":"SSL"},"endpoints":["CONTROLPLANE-9090://my-cluster-kafka-0.my-cluster-kafka-brokers.myproject.svc:9090","REPLICATION-9091://my-cluster-kafka-0.my-cluster-kafka-brokers.myproject.svc:9091","PLAIN-9092://my-cluster-kafka-0.my-cluster-kafka-brokers.myproject.svc:9092","TLS-9093://my-cluster-kafka-0.my-cluster-kafka-brokers.myproject.svc:9093"],"jmx_port":-1,"port":9092,"host":"my-cluster-kafka-0.my-cluster-kafka-brokers.myproject.svc","version":5,"timestamp":"1710691902130"}
```

As mentioned, the controller election happens when the first broker creates the ephemeral `/controller` node storing the broker ID.

```shell
get /controller
{"version":2,"brokerid":0,"timestamp":"1710691902625","kraftControllerEpoch":-1}
```

Finally, the `/config/topics` znode lists all the topics in the cluster with the corresponding configuration.

```shell
get /config/topics/my-topic
{"version":1,"config":{"retention.ms":"100000"}} // all the other configuration parameters are omitted because using default values
```

ZooKeeper is designed to be replicated across a number of nodes which built an ensemble.
A leader node is the one where all the write requests got by clients are forwarded from the other nodes and the operations are coordinated by using the ZooKeeper Atomic Broadcast (ZAB) protocol.
This protocol keeps all nodes in sync and ensures reliability on messages delivery.

But having ZooKeeper means dealing with a totally different system which needs to be deployed, managed and troubleshooted.
The admin doesn't have to take care of the Kafka cluster only but also the ZooKeeper ensemble running alongside it.
Because ZooKeeper requires a quorum, not having the majority of nodes to process requests can also affect the Kafka cluster's availability.

ZooKeeper also represents a bottleneck for scalability and puts a limit on the number of topics and the corresponding partitions supported within a Kafka cluster.
It has a performance impact when, for example, there is a controller failover and the new elected one has to fetch metadata from ZooKeeper, including all the topics information.
Also, any metadata update needs to be propagated to the other brokers.
The problem is that the metadata changes propagations, by using RPCs, grow with the number of topics' partitions involved and more partitions means more metadata to propagate, so it takes longer and the system gets slower.

### Welcome to KRaft!

In order to overcome the limitations related to the ZooKeeper usage, the Kafka community came with the idea of using Kafka itself to store metadata and using the event-driven pattern to take them updated across the nodes.
The work started with [KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum) in late 2019 by introducing a self-managed metadata quorum based on a specific Kafka implementation of the [Raft](https://raft.github.io/) consensus protocol.
That was named Kafka Raft ... KRaft for friends!

KRaft is an event-based implementation of the Raft protocol with a quorum controller maintaining an event log, a single-partition topic named `__cluster_metadata`, to store the metadata.
It works in a leader-follower mode, where the leader writes events into the metadata topic which is then replicated to the follower controllers by using the KRaft replication algorithm.
The leader of that single-partition topic is actually the controller node of the Kafka cluster.
The metadata changes propagation has the benefit of being event-driven via replication and not using RPCs anymore.
The metadata management is directly within Kafka itself with the usage of a new quorum controller service which uses an event-sources storage model.
The KRaft protocol is used to ensure that metadata are fully replicated across the quorum.

TBD: put a picture of KRaft quorum controller together with metadata topic

Getting rid of an external system like ZooKeeper simplifies the overall architecture and removes the burden of taking care of an additional component.
The scalability is also improved by reducing the load on the metadata store by using snapshots to avoid unbounded growth (compacted topic).
When there is a leadership change in the quorum controller, the new leader already has all the committed metadata records so the recovery is pretty fast.

Another interesting aspect of using the KRaft mode is about the role that a single node can have within the cluster itself.
By using the new `process.roles` configuration parameter, a Kafka node can act as a `broker`, a `controller` or being in mixed-mode.
As a `broker`, it is responsible to communicate with the Kafka clients and to store and serve data by handing read and write requests on topics.
As a `controller`, it takes part at the quorum controller being a leader or follower, storing the cluster state and handling the metadata changes.
Effectively, `broker` and `controller` are two different services running on the node within the JVM.
When in mixed-mode, it gets both roles by taking care of Kafka clients communication on one hand and metadata changes on the other.
Using the mixed-mode allows to reduce the number of nodes within the cluster compared to a ZooKeeper configuration, even if it is not recommended to be used in a production environment but only for testing or development purposes.

### How to migrate from ZooKeeper to KRaft

As today, it is expected to have users who are running ZooKeeper-based clusters but they are interested in migrating to KRaft mode as soon as possible in order to overcome all the limitations we have talked about.
Furthermore, ZooKeeper is already considered as deprecated by the Apache Kafka community and its support will be removed with the 4.0 release later this year or early the next one.

There is a manual procedure, made by several phases, to run in order to execute such a migration.
The following content doesn't want to be an exhaustive description of the migration procedure but more an overview of how it is supposed to work.
For more details, please refer to the official [ZooKeeper to KRaft Migration](https://kafka.apache.org/documentation/#kraft_zk_migration) documentation.

#### Deploying the KRaft controller quorum

At the beginning, we have the Kafka brokers running in ZooKeeper-mode and connected to the ZooKeeper ensemble used to store metadata.

![ZooKeeper-based cluster](/assets/images/posts/2024-03-22-kraft-migration-01-zk-brokers.png)

> NOTE: the green square boxed number highlights the "generation" of the nodes which are rolled more times during the process.

The first step is about deploying the KRaft controller quorum which will be in charge of storing the metadata in KRaft mode.
In general, the number of nodes will be the same as the number of the ZooKeeper nodes actually running.
It is also important to highlight that the migration doesn't support the usage of mixed-nodes.
The nodes forming the KRaft controller quorum are all configured with the connection to ZooKeeper together with the additional `zookeeper.metadata.migration.enable=true` flag which states the intention to run the migration.
When the KRaft controllers start, they form a quorum, elect the leader and move in a state where they are waiting for the brokers to register.

![KRaft controller quorum deployed](/assets/images/posts/2024-03-22-kraft-migration-02-kraft-deployed.png)

#### Enabling brokers to run the migration

The next step is about moving the brokers to migration mode.
In order to do so, the brokers configuration needs to be updated by adding the connection to the KRaft controller quorum and enabling the migration with the `zookeeper.metadata.migration.enable=true` flag.
After the update, the brokers need to be rolled one by one to make such configuration changes effective.
On restart, the brokers register to the KRaft controller quorum and the migration begins.
The KRaft controller leader copies all metadata from ZooKeeper to the `__cluster_metadata` topic.

![KRaft migration running](/assets/images/posts/2024-03-22-kraft-migration-03-kraft-migration.png)

While the migration is running, you can verify its status by looking at the log on the KRaft controller leader or by checking the `ZkMigrationState` metric.
When the migration is completed, the brokers are anyway still running in ZooKeeper mode.
The KRaft controllers are in charge of handling any requests related to metadata changes within the cluster but they keep sending RPCs to the brokers for metadata updates.
The metadata are still copied to ZooKeeper and the cluster is working in a so called "dual-write" mode.

![KRaft dual-write](/assets/images/posts/2024-03-22-kraft-migration-04-kraft-dual-write.png)

#### Moving brokers to be full KRaft

The next step is about moving the brokers to be in full KRaft mode and not using ZooKeeper anymore.
In order to do so, the brokers configuration is updated by removing the connection to ZooKeeper and disabling the migration flag.
All the brokers are rolled again and, on restart, they are now in full KRaft mode without any connection or usage of ZooKeeper.
The KRaft controllers are still in "dual-write" mode and any metadata changes are copied to ZooKeeper.

![Brokers only full KRaft](/assets/images/posts/2024-03-22-kraft-migration-05-brokers-kraft.png)

#### Migration finalization

The final step is about reconfiguring the KRaft controllers without the connection to ZooKeeper and disabling the migration flag.
When all the KRaft controllers are rolled, the cluster is working in full KRaft mode and the ZooKeeper ensemble is not used anymore.
From now on, it is possible to deprovision the ZooKeeper nodes if not used for any other purposes within your environment.

![Cluster full KRaft](/assets/images/posts/2024-03-22-kraft-migration-06-kraft-cluster.png)

#### Rollback support

During the migration process is also possible to execute a rollback procedure to revert the cluster to use the ZooKeeper ensemble again.
The rollback is allowed until the KRaft controllers are still connected to ZooKeeper because they are working in "dual-write" mode by effectively copying metadata to ZooKeeper.
When the migration is finalized and the KRaft controllers are not connected to ZooKeeper, the rollback is not possible anymore.

### Strimzi migration support

The migration procedure is not that easy and it relies on updating brokers and controllers configurations multiple times together with rolling the involved nodes across several phases.
There is a lot of manual intervention even related to verify the migration status by looking at the KRaft controller leader log or checking the `ZkMigrationState` metric.
But if you are using the Strimzi operator to run your current ZooKeeper-based cluster on Kubernetes, the migration process is semi-automated.
What you have to do is just updating the `strimzi.io/kraft` annotation on the `Kafka` cluster resource in order to allow the internal migration Finite State Machine (FSM) to move across the different phases.
The operator is going to apply the needed configuration to the nodes and roll them.
It is also in charge of checking the migration status looking at the metrics for you to make sure it was done successfully.

Before latest Strimzi 0.40.0 release, the `strimzi.io/kraft` annotation on the `Kafka` custom resource was used to define a ZooKeeper-based cluster, by using the `disabled` value, or a KRaft-based cluster, by using the `enabled` value.

It is now possible to use two more values for the `strimzi.io/kraft` annotation: `migration` to start the migration process and `rollback` to revert the migration itself.
One of the main prerequisites for the migration is about having the ZooKeeper-based cluster using the `KafkaNodePool`(s) to run the brokers.
If that is not the case for you, please refer to the official Strimzi documentation [here](https://strimzi.io/docs/operators/latest/deploying#proc-migrating-clusters-node-pools-str).

Following there is a snippet of a `Kafka` custom resource highlighting node pools enabled and using ZooKeeper for metadata.

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

The first step is about deploying a `KafkaNodePool` custom resource which hosts the KRaft controllers and then changing the `strimzi.io/kraft` annotation from `disabled` to `migration`.

Following a snippet of a `KafkaNodePool` custom resource to be deployed for getting the KRaft controllers running.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: kafka
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

The annotation change triggers the Strimzi operator to run the following steps for you:

* deploy the KRaft controllers, which are configured to be connected to ZooKeeper and with the migration flag enabled;
* configure the running brokers with the connection to the KRaft controller quorum, the migration flag enabled and roll them;
* checking the status of the migration, on each reconciliation, and updating the `Kafka` custom resource to provide such status to the user through the `status.kafkaMetadataState` field;
* when the migration is done, the brokers are reconfigured to be not connected to ZooKeeper, with the migration flag disabled and they are rolled again.

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

The operator will configure the KRaft controllers without the ZooKeeper connection, with the migration flag disabled and roll them.
When the cluster is full KRaft, the operator will delete all the resources related to ZooKeeper as well.

During the finalization, the cluster metadata state moves to the final `KRaft`.

NAME         DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   METADATA STATE   WARNINGS
...
my-cluster   3                        3                     True    KRaftPostMigration   True
my-cluster   3                        3                     True    PreKRaft             True
my-cluster   3                        3                     True    KRaft                True
my-cluster                                                  True    KRaft                True
my-cluster                                                  True    KRaft                

As you can see, just a couple of changes on the `strimzi.io/kraft` annotation make the migration really straight forward.

#### Rollback support

When the migration is not finalized yet, so when the KRaft controllers are still connected to ZooKeeper, it is still possible to rollback.
By applying the `rollback` value on the `strimzi.io/kraft` annotation, the operator reconfigure the brokers to be connected to ZooKeeper again and roll them.

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

After that, you have to delete the `KafkaNodePool` hosting the KRaft controllers and then apply the `disabled` value annotation in order to allow the operator to configure brokers not being connected to the KRaft controller quorum anymore but using ZooKeeper again and electing the new controller among them.

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

The Apache Kafka community has deprecated the usage of ZooKeeper to store the cluster metadata and it will be totally removed in the 4.0 version coming later this year or early the next one.
It means that users should move soon to create new KRaft-based clusters only.
Of course, there are a lot of ZooKeeper-based clusters already running in production out there which need to be migrated.
While the manual process could be considered long and complex if your cluster is running on bare-metal or virtual machines, it is very easy if the cluster is running on Kubernetes instead.
The Strimzi operator provides you a semi-automated process which needs just a few manual steps to update an annotation to migrate your cluster.
If it is about testing on a development environment or a production one, let us know your experience about migrating your cluster with Strimzi.
Your feedback are very welcome!