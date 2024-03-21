---
layout: post
title:  "From ZooKeeper to KRaft: How the Kafka migration works"
date: 2024-03-20
author: paolo_patierno
---

The Apache Kafka project has been using [Apache ZooKeeper](https://zookeeper.apache.org/) since its inception to store metadata.
Registered brokers, the current controller and topics' configuration are just a few of the data that ZooKeeper stores for supporting a running Kafka cluster.
Using a dedicated and centralized system for maintaining cluster metadata and offload leader election was the right approach at that time, because ZooKeeper was battle tested and it is purpose built for providing distributed coordination.
But taking care of an additional component alongside your Kafka cluster is not that simple.
Furthermore, ZooKeeper has become a bottleneck that limits the amount of partitions that a single broker can handle.
For these and other reasons, the Kafka community opened the "famous" [KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum) in late 2019 and started to work toward the ZooKeeper removal.
Through this blog post we are going to describe the main differences between using ZooKeeper and KRaft to store the cluster metadata and how the migration from the former to the latter works.

<!--more-->

### What is "wrong" with ZooKeeper?

As already mentioned, Kafka has been using ZooKeeper as its metadata management system for several tasks.
Some of them are:

* **Cluster membership**: each broker, joining the Kafka cluster, registers itself with a ephemeral znode on ZooKeeper;
* **Controller election**: when a broker starts, it tries to take the "controller" role by creating the ephemeral `/controller` znode on ZooKeeper. If that znode already exists, it indicates which broker is the current controller;
* **Topics configuration**: all the topics' configuration parameters are stored in ZooKeeper together with information like the number of partitions and the current broker assignments for the replicas;
* **Access Control Lists (ACLs)**: when a client connects to the cluster, it could be authenticated and authorized to read or write on several topics based on the ACLs stored in ZooKeeper by the built-in Authorizer;
* **Quotas**: brokers can limit resources used by clients in terms of network bandwidth and CPU utilization via quotas stored in ZooKeeper by the built-in Quotas provider;

Assuming to have a ZooKeeper-based Kafka cluster `my-cluster` deployed with Strimzi on Kubernetes in the `kafka` namespace, you can use the `zookeeper-shell` tool on one of the ZooKeeper pods and see all the znodes.

```shell
kubectl exec -it my-cluster-zookeeper-0 -n kafka -- bin/zookeeper-shell.sh localhost:12181
```

The brokers within the cluster are listed under the `/brokers` znode and for each of them there are information about their endpoints.

```shell
ls /brokers/ids
[0, 1, 2]

get /brokers/ids/0
{"features":{},"listener_security_protocol_map":{"CONTROLPLANE-9090":"SSL","REPLICATION-9091":"SSL","PLAIN-9092":"PLAINTEXT","TLS-9093":"SSL"},"endpoints":["CONTROLPLANE-9090://my-cluster-kafka-0.my-cluster-kafka-brokers.kafka.svc:9090","REPLICATION-9091://my-cluster-kafka-0.my-cluster-kafka-brokers.kafka.svc:9091","PLAIN-9092://my-cluster-kafka-0.my-cluster-kafka-brokers.kafka.svc:9092","TLS-9093://my-cluster-kafka-0.my-cluster-kafka-brokers.kafka.svc:9093"],"jmx_port":-1,"port":9092,"host":"my-cluster-kafka-0.my-cluster-kafka-brokers.kafka.svc","version":5,"timestamp":"1710691902130"}
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

ZooKeeper data is replicated across a number of nodes which form an ensemble.
ZooKeeper uses the ZooKeeper Atomic Broadcast (ZAB) protocol to replicate data to all nodes in the ZooKeeper ensemble.
This protocol keeps all nodes in sync and ensures reliability on messages delivery.

But having ZooKeeper means operating a totally different distributed system which needs to be deployed, managed and troubleshooted.
ZooKeeper also represents a bottleneck for scalability and puts a limit on the number of topics and the corresponding partitions supported within a Kafka cluster.
It has a performance impact when, for example, there is a controller failover and the new elected one has to fetch metadata from ZooKeeper, including all the topics information.
Also, any metadata update needs to be propagated to the other brokers.
The problem is that the metadata changes propagations, by using RPCs, grow with the number of partitions involved so it takes longer and the system gets slower.

### Welcome to KRaft!

In order to overcome the limitations related to the ZooKeeper usage, the Kafka community came with the idea of using Kafka itself to store metadata and using the event-driven pattern to take them updated across the nodes.
The work started with [KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum) in late 2019 with the introduction of a built-in consensus protocol based on [Raft](https://raft.github.io/).
That was named Kafka Raft ... KRaft for friends!

KRaft is an event-based implementation of the Raft protocol with a quorum controller maintaining an event log, a single-partition topic named `__cluster_metadata`, to store the metadata.
Unlike the other topics, this is a special one, because records are written to disk synchronously, which is required by the Raft algorithm for correctness.
It works in a leader-follower mode, where the leader writes events into the metadata topic which is then replicated to the follower controllers by using the KRaft replication algorithm.
The leader of that single-partition topic is actually the controller node of the Kafka cluster.
The metadata changes propagation has the benefit of being event-driven via replication instead of using RPCs anymore.
The metadata management is part of Kafka with the usage of a new quorum controller service which uses an event-sources storage model.
The KRaft protocol is used to ensure that metadata are fully replicated across the quorum.

![Cluster metadata topic](/assets/images/posts/2024-03-20-kraft-migration-metadata-topic.png)

By using the `kafka-dump-log.sh` tool together with the `--cluster-metadata-decoder` option, you are able to dump the content of the `__cluster_metadata` segments and see how several events are generated in relation to metadata changes.

Assuming to have a KRaft-based Kafka cluster `my-cluster` deployed with Strimzi on Kubernetes in the `kafka` namespace, you can run the following command on the KRaft active controller node (that is `my-cluster-controller-0`).

```shell
kubectl exec -it my-cluster-controller-0 -n kafka -- bin/kafka-dump-log.sh --cluster-metadata-decoder --files /var/lib/kafka/data-0/kafka-log0/__cluster_metadata-0/00000000000000000000.log
Dumping /var/lib/kafka/data-0/kafka-log0/__cluster_metadata-0/00000000000000000000.log
```

For example, you could see a `REGISTER_BROKER_RECORD` event related to cluster membership, when a new broker joins the cluster.

```shell
| offset: 53 CreateTime: 1710772983743 keySize: -1 valueSize: 308 sequence: -1 headerKeys: [] payload: {"type":"REGISTER_BROKER_RECORD","version":3,"data":{"brokerId":3,"isMigratingZkBroker":false,"incarnationId":"5TICkSDlQOGOHY-sn-TtDw","brokerEpoch":53,"endPoints":[{"name":"REPLICATION-9091","host":"my-cluster-broker-3.my-cluster-kafka-brokers.kafka.svc","port":9091,"securityProtocol":1},{"name":"PLAIN-9092","host":"my-cluster-broker-3.my-cluster-kafka-brokers.kafka.svc","port":9092,"securityProtocol":0},{"name":"TLS-9093","host":"my-cluster-broker-3.my-cluster-kafka-brokers.kafka.svc","port":9093,"securityProtocol":1}],"features":[{"name":"metadata.version","minSupportedVersion":1,"maxSupportedVersion":19}],"rack":null,"fenced":true,"inControlledShutdown":false,"logDirs":["uHY7hO6-42Q7O4k0zLMmtg"]}}
```

When a topic is created, a `TOPIC_RECORD` event followed by a `CONFIG_RECORD` one together with multiple `PARTITION_RECORD` events would be generated.
These records bring the topic creation, the corresponding custom configuration and how the partitions are distributed across the brokers.

```shell
| offset: 3004 CreateTime: 1710774451597 keySize: -1 valueSize: 29 sequence: -1 headerKeys: [] payload: {"type":"TOPIC_RECORD","version":0,"data":{"name":"my-topic","topicId":"xOxBrcYuSRWgtFuZIBiXIA"}}
| offset: 3005 CreateTime: 1710774451597 keySize: -1 valueSize: 34 sequence: -1 headerKeys: [] payload: {"type":"CONFIG_RECORD","version":0,"data":{"resourceType":2,"resourceName":"my-topic","name":"retention.ms","value":"100000"}}
| offset: 3006 CreateTime: 1710774451597 keySize: -1 valueSize: 113 sequence: -1 headerKeys: [] payload: {"type":"PARTITION_RECORD","version":1,"data":{"partitionId":0,"topicId":"xOxBrcYuSRWgtFuZIBiXIA","replicas":[5,3,4],"isr":[5,3,4],"removingReplicas":[],"addingReplicas":[],"leader":5,"leaderEpoch":0,"partitionEpoch":0,"directories":["SaZDxfHKu3NMZ7OnFP7YnA","uHY7hO6-42Q7O4k0zLMmtg","p2UpbSD99eygD2ZToiSMzg"]}}
| offset: 3007 CreateTime: 1710774451597 keySize: -1 valueSize: 113 sequence: -1 headerKeys: [] payload: {"type":"PARTITION_RECORD","version":1,"data":{"partitionId":1,"topicId":"xOxBrcYuSRWgtFuZIBiXIA","replicas":[3,4,5],"isr":[3,4,5],"removingReplicas":[],"addingReplicas":[],"leader":3,"leaderEpoch":0,"partitionEpoch":0,"directories":["uHY7hO6-42Q7O4k0zLMmtg","p2UpbSD99eygD2ZToiSMzg","SaZDxfHKu3NMZ7OnFP7YnA"]}}
| offset: 3008 CreateTime: 1710774451597 keySize: -1 valueSize: 113 sequence: -1 headerKeys: [] payload: {"type":"PARTITION_RECORD","version":1,"data":{"partitionId":2,"topicId":"xOxBrcYuSRWgtFuZIBiXIA","replicas":[4,5,3],"isr":[4,5,3],"removingReplicas":[],"addingReplicas":[],"leader":4,"leaderEpoch":0,"partitionEpoch":0,"directories":["p2UpbSD99eygD2ZToiSMzg","SaZDxfHKu3NMZ7OnFP7YnA","uHY7hO6-42Q7O4k0zLMmtg"]}}
```

All the possible metadata changes are encoded as specific event records in the metadata log topic in Apache Kafka.
They are all described using JSON files (which are then used to automatically build the corresponding Java classes) you can find [here](https://github.com/apache/kafka/tree/trunk/metadata/src/main/resources/common/metadata).

Removing an external system like ZooKeeper simplifies the overall architecture and removes the burden of operating an additional component.
The scalability is also improved by reducing the load on the metadata store by using snapshots to avoid unbounded growth (like compacted topic).
When there is a leadership change in the controller quorum, the new leader already has all the committed metadata records so the recovery is pretty fast.

Another interesting aspect of using the KRaft mode is about the role that a single node can have within the cluster itself.
By using the new `process.roles` configuration parameter, a Kafka node can act as a `broker`, a `controller` or perform both roles in "combined" mode
A `broker` node is responsible for handing requests, including reads and writes on topics, from Kafka clients.
A `controller` node takes part in the controller quorum and replicates the metadata log. At any time, one of the `controller` nodes is the quorum leader and the others are followers that can take over in case the current leader resigns if it's restarted or fails for example.

Effectively, `broker` and `controller` are two different services running on the node within the JVM.
When in "combined" mode, a node performs both roles with the corresponding responsibilities.
Using the "combined" mode allows to reduce the number of nodes within the cluster compared to a ZooKeeper configuration.
It is not recommended for critical use cases as this offers less isolation in case of failures.
This mode is useful for small use cases, for example it allows setting up a Kafka development environment by starting a single node.

### How to migrate from ZooKeeper to KRaft

Today, most of the existing Kafka clusters are ZooKeeper-based.
Users are interested in migrating to KRaft mode in order to overcome all the limitations we have talked about.
While KRaft is production ready for a few releases already, it lacked important features (JBOD support is still in early access) so few new clusters were deployed in KRaft mode.

Furthermore, ZooKeeper is already considered as deprecated and, with the Kafka project expecting to remove ZooKeeper support in an upcoming 4.0 release, expected in 2024, it is now time to consider migrating clusters from ZooKeeper to KRaft.

There is a manual procedure, consisting of several phases, to run in order to migrate a cluster without any downtime.
The following content doesn't want to be an exhaustive description of the migration procedure but more an overview of how it is supposed to work.
For more details, please refer to the official [ZooKeeper to KRaft Migration](https://kafka.apache.org/documentation/#kraft_zk_migration) documentation.

#### Deploying the KRaft controller quorum

At the beginning, we have the Kafka brokers running in ZooKeeper-mode and connected to the ZooKeeper ensemble used to store metadata.

![ZooKeeper-based cluster](/assets/images/posts/2024-03-20-kraft-migration-01-zk-brokers.png)

> NOTE: The green square boxed number highlights the "generation" of the nodes while will be rolled several times during the process.

The first step is to deploy the KRaft controller quorum which will be in charge of maintaining the metadata in KRaft mode.
In general, the number of KRaft controller nodes will be the same as the number of the ZooKeeper nodes currently running.
It is also important to highlight that the migration process doesn't support migrating to nodes running in "combined" mode.
The nodes forming the KRaft controller quorum are all configured with the connection to ZooKeeper together with the additional `zookeeper.metadata.migration.enable=true` flag which states the intention to run the migration.
When the KRaft controllers start, they form a quorum, elect the leader and move in a state where they are waiting for the brokers to register.

![KRaft controller quorum deployed](/assets/images/posts/2024-03-20-kraft-migration-02-kraft-deployed.png)

#### Enabling brokers to run the migration

The next step is to move the brokers to migration mode.
In order to do so, the brokers' configuration needs to be updated by adding connection details for all nodes of the KRaft controller quorum and enabling the migration with the `zookeeper.metadata.migration.enable=true` flag.
After the update, the brokers need to be rolled one by one to make such configuration changes effective.
On restart, the brokers register to the KRaft controller quorum and the migration begins.
The KRaft controller leader copies all metadata from ZooKeeper to the `__cluster_metadata` topic.

![KRaft migration running](/assets/images/posts/2024-03-20-kraft-migration-03-kraft-migration.png)

While the migration is running, you can verify its status by looking at the log on the KRaft controller leader or by checking the `kafka.controller:type=KafkaController,name=ZkMigrationState` metric.
When the migration is completed, that is the metric value becomes `MIGRATION`, the brokers are still running in ZooKeeper mode.
The KRaft controllers are in charge of handling any requests related to metadata changes within the cluster but they keep sending RPCs to the brokers for metadata updates.
Metadata updates are still copied to ZooKeeper and the cluster is working in a so called "dual-write" mode.

![KRaft dual-write](/assets/images/posts/2024-03-20-kraft-migration-04-kraft-dual-write.png)

#### Restarting the brokers in KRaft mode

The next step is to restart the brokers in KRaft mode and not using ZooKeeper anymore.
In order to do so, the brokers configuration is updated by removing the connection to ZooKeeper and disabling the migration flag.
All the brokers are rolled again and, on restart, they are now in full KRaft mode without any connection or usage of ZooKeeper.
The KRaft controllers are still in "dual-write" mode and any metadata changes are copied to ZooKeeper.
It is important to highlight this is the last chance to rollback and keep using ZooKeeper to store metadata.

![Brokers only full KRaft](/assets/images/posts/2024-03-20-kraft-migration-05-brokers-kraft.png)

#### Migration finalization

The final step is to reconfigure the KRaft controllers without the connection to ZooKeeper and disabling the migration flag.
When all the KRaft controllers are rolled, the cluster is working in full KRaft mode and the ZooKeeper ensemble is not used anymore.
From now on, you should deprovision the ZooKeeper nodes from your environment.

![Cluster full KRaft](/assets/images/posts/2024-03-20-kraft-migration-06-kraft-cluster.png)

#### Rollback support

During the migration process, it is also possible to execute a rollback procedure to revert the cluster to use the ZooKeeper ensemble again.
The rollback is allowed until the KRaft controllers are still connected to ZooKeeper because they are working in "dual-write" mode by effectively copying metadata to ZooKeeper.
When the migration is finalized and the KRaft controllers are not connected to ZooKeeper, the rollback is not possible anymore.

### Conclusion

The Apache Kafka community has deprecated the usage of ZooKeeper to store the cluster metadata and it will be completely removed in the 4.0 version coming later this year or early the next one.
It means that users should move soon to create new KRaft-based clusters only.
Of course, there are a lot of ZooKeeper-based clusters already running in production out there which need to be migrated.
The migration process is not trivial and needs a lot of manual intervention, with configuration updates and nodes to be rolled.
But if you are running your cluster on Kubernetes, we'll see in an upcoming blog post how the Strimzi operator provides a semi-automated approach making the migration a lot easier!