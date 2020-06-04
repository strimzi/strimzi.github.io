---
layout: post
title:  "Cluster balancing with Cruise Control"
date: 2020-06-05
author: tom_cooper
---

Kafka allows you to scale your broker infrastructure to cope with massive load, brokers can be added easily to increase capacity. However, new brokers will only play host to new the partitions topics created after the broker was added to the cluster. 
If certain brokers in your existing cluster are currently under heavy load, then adding a new broker to the cluster will not relieve pressure on the others. 
To do that you would need to manually [reassign partiton replicas](https://kafka.apache.org/documentation/#basic_ops_partitionassignment) to the new broker (using the [partition reassignment tool](https://cwiki.apache.org/confluence/display/KAFKA/Replication+tools#Replicationtools-4.ReassignPartitionsTool)). 
Similarly, imagine that you have a cluster where, for whatever reason, one broker happens to hold a disproportionate number of partition leaders for partitions under heavy load. 
To solve this issue you would need to figure out which partitions are under load, identify other brokers with lower load which hold replicas for those partition, and then reassign the partition leadership to even out the load across the cluster. 
This is no easy task. 

Enter [Cruise Control](https://github.com/linkedin/cruise-control), a project from Linkedin, which automates the _balancing_ of load across a Kafka cluster. [Last year]({% post_url 2019-08-08-hacking-for-cruise-control %}), Kyle Liberti described how you could manually get Cruise Control working with Strimzi. 
With the latest [0.18.0 release](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.18.0), Strimzi now provides native Cruise Control support. 

<!--more-->

## Cruise Control overview

Cruise Control started out as an internal project at Linkedin and was used for managing their in-house Kafka clusters. 
It was open sourced in 2016 and has seen constant development since then. 

Cruise Control consists of a main server implementation that contains several sub-systems for monitoring, analyzing and proposing changes to the Kafka Cluster it monitors. 
As well as the main server, Cruise Control provides a Kafka metrics reporter implementation that, once installed into the Kafka brokers, filters and records a wide range of metrics provided by the brokers themselves.

The Cruise Control server periodically collects the metrics recorded by the metrics reporters (which are sent to specific metrics topics within the cluster) to infer the traffic pattern of each partition. 
Based on the traffic characteristics and distribution of all the partitions, it derives the load impact of each partition on the brokers. 
Cruise Control then builds a workload model to simulate the workload of the Kafka cluster. 

The user can define a list of _optimization goals_. 
These goals each define a set of parameter values that the cluster state should meet. 
For example a goal can enforce that network traffic for each broker should not differ by more than +/- 10% of the cluster's average. 
These goals are configured in a priority order and when required the Cruise Control server's analyzer sub-system will attempt to change the workload model to meet each goal. 
These changes consist of switching the lead replica of a given partition or reassigning partitions to other brokers. 
The analyzer will descend down the list of goals and first check if the current cluster configuration meets that goal and if it doesn't will attempt to alter the cluster model until it does. 
At each step any generated changes are passed to all the previous goals in the list to check if they will then violate those higher priority goals.

Each of the goals can either be _hard_ or _soft_. A hard goal **must** be satisfied, if the analyzer proposes changes that violate a hard goal then those changes are rejected. 
A soft goal can be violated. 
Therefore an _optimization proposal_, which is a collection of changes resulting from a full pass over a given list of goals, will meet the requirements of all the hard goals in that list but may not satisfy all of the soft goals. It is worth noting that if it is not possible to meet all the hard goals then no optimization proposal will be produced.

For a more detailed breakdown of how Cruise Control does what it does, see the project's [wiki](https://github.com/linkedin/cruise-control/wiki/Overview), this introduction talk ([video](https://www.youtube.com/watch?v=lf31udm9cYY) / [slides](https://www.slideshare.net/JiangjieQin/introduction-to-kafka-cruise-control-68180931)) and this [updated talk](https://www.youtube.com/watch?v=jdo6F21gI8g) from the developers themselves.

## Strimzi Cruise Control support

Cruise Control's optimization approach allows it to perform several different operations linked to balancing cluster load. 
As well as rebalancing a whole cluster, Cruise Control also has the ability to do this balancing automatically when adding and removing brokers or changing topic replica values. 
Cruise Control can also supply information on cluster load, can monitor the cluster for anomalies and even perform (limited) automated self-healing actions. 

This is an impressive list of features and to enact them Cruise Control has the ability to manipulate the state and configuration of the Kafka cluster it is monitoring. 
Something else that likes to manipulate the state and configuration of your Kafka cluster is the Strimzi Cluster Operator. 
This means that combining these two systems is not a straight forward task and we are not supporting all the Cruise Control features in this initial release. 
For now, we are supporting the whole-cluster rebalance functionality. The operator will handle installing the metrics reporters in the brokers and setting up the Cruise Control server for you. 
You can then post a Kubernetes Custom Resource (described in the [guide below](#rebalancing-your-cluster)) to handle the rebalance for you, all in a Kubernetes native, Cluster Operator friendly way. 
We will continue to improve the Cruise Control integration and add more functionality over then next few Strimzi releases.

*Note*: The eagle-eyed among you may have had a look at the upstream [Cruise Control documentation](https://github.com/linkedin/cruise-control/wiki/REST-APIs) and seen all the options that the REST API gives you. 
For now, we have locked down access to that API, as it can change things outside of the Cluster Operator's control. 
In future, where it makes sense to, we will provide Strimzi native ways to get access to the API features. 
If there are some of these features you want access to ASAP please [reach out to us](https://strimzi.io/community/), we would love to hear from you!

## Rebalancing your cluster

So, now we have convinced you that rebalancing your cluster is a useful thing to do, how do you go about doing it in the new shiny Strimzi release? 
Obviously, you should always read [the docs](https://strimzi.io/docs/operators/latest/using.html#cruise-control-concepts-str) first. 
But for illustration, we will go through a typical cluster rebalance below:

### Deploying Cruise Control

The first job is to get the metrics reporters installed in your cluster's brokers and get the Cruise Control sever deployment created. To do this add the following to your `Kafka` custom resource:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  # ...
  cruiseControl: {}
```

This will use all the default Cruise Control settings to deploy the Cruise Control server. 
If you are adding Cruise Control to an existing cluster (instead of starting a fresh cluster) then you will see all your Kafka broker pods roll so that the metrics reporter can be installed. 
Eventually, you should see the Cruise Control deployment in your cluster:

```bash
$ kubectl get pods -n myproject   
NAME                                          READY   STATUS    RESTARTS   AGE
my-cluster-cruise-control-7f46f588b8-66whz    2/2     Running   0          8m48s
my-cluster-entity-operator-77d8f884d5-jxmht   3/3     Running   0          12m
my-cluster-kafka-0                            2/2     Running   0          9m12s
my-cluster-kafka-1                            2/2     Running   0          10m
my-cluster-kafka-2                            2/2     Running   0          9m46s
my-cluster-zookeeper-0                        1/1     Running   0          13m
my-cluster-zookeeper-1                        1/1     Running   0          13m
my-cluster-zookeeper-2                        1/1     Running   0          13m
strimzi-cluster-operator-54565f8c56-rmdb8     1/1     Running   0          14m
```

Now Cruise Control is deployed it will start pulling in metrics from the topics created by the metrics reporters in each broker.

### Cruise Control configuration

The deployment above uses the default Cruise Control configurations. 
This will use the upstream project's optimization goals list priorities (with a few exceptions) and their hard/soft goal configuration. 
If you are feeling adventurous, you can configure your own optimization priorities. 
You can do this via three main configuration options at the Cruise Control deployment level (there are also rebalance request level options as well - which are covered in the [sections below](#custom-rebalace-goals).

- `goals`: This configures the _master_ goals list. Basically, this is the list of goals that are allowed to be used in any of Cruise Control's functions. You would use this primarily to limit the optimization goals that that users of your cluster's Cruise Control server can use. For example if, for some reason, you don't want any cluster user to use the preferred leader election goal, you can define a `goals` list that does not include it.
- `hard.goals`: This list of goals will define which goals in the master goals list are considered _hard_ and cannot be violated in any of the optimization functions of Cruise Control. The longer this list, the less likely it is that Cruise Control will be able to find a viable optimization proposal, so if you do customise this, try to make it as short as possible.
- `default.goals`: The default goals list is the most important of these configurations. By default, every 15 mins, Cruise Control will use the current state of your Kafka cluster to generate a _cached optimization proposal_ using the configured `default.goals` list. This means you should configure the `default.goals` list to be the set of goals that you will most often want your cluster to meet. That way, when you ask for a rebalance, a optimization proposal should be already prepared.

All these configuration options can be set under `Kafka.spec.cruiseControl.config`. 
Please consult the [Strimzi documentation](https://strimzi.io/docs/operators/latest/using.html#con-optimization-goals-str) for more detailed information on the various goal configurations.

### Getting an optimization proposal

Now you have Cruise Control deployed you can ask it to generate a optimization proposal. 
To do this you will need to apply a `KafkaRebalance` custom resource (the definition for this is installed when you install Strimzi). 
A basic `KafkaRebalance` is shown below:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaRebalance
metadata:
  name: my-rebalance
  labels:
    strimzi.io/cluster: my-cluster
  spec: {}
```

And you can deploy this like any other resource:

```bash
kubectl apply -f kafka-rebalance.yaml -n myproject
```

This rebalance has an empty `spec` field and so will use the default rebalance settings. 
This means it will use the `default.goals` (mentioned above) and will return the most recent _cached optimization proposal_. 
Once you apply this resource to your Kafka cluster the Cluster Operator will issue the relevant requests to Cruise Control to fetch the optimization proposal. 
The Cluster Operator will keep the status of your `KafkaRebalance` updated with the progress from Cruise Control. 
You can check this using:

```bash
$ kubectl describe kafkarebalance my-rebalance -n myproject     
```

This will show an output like that shown below:

```yaml
Name:         my-rebalance
Namespace:    myproject
Labels:       strimzi.io/cluster=my-cluster
Annotations:  API Version:  kafka.strimzi.io/v1alpha1
Kind:         KafkaRebalance
Metadata:
# ...
Status:
  Conditions:
    Last Transition Time:  2020-06-04T14:36:11.900Z
    Status:                ProposalReady
    Type:                  State
  Observed Generation:     1
  Optimization Result:
    Data To Move MB:  0
    Excluded Brokers For Leadership:
    Excluded Brokers For Replica Move:
    Excluded Topics:
    Intra Broker Data To Move MB:         12
    Monitored Partitions Percentage:      100
    Num Intra Broker Replica Movements:   0
    Num Leader Movements:                 24
    Num Replica Movements:                55
    On Demand Balancedness Score After:   82.91290759174306
    On Demand Balancedness Score Before:  78.01176356230222
    Recent Windows:                       5
  Session Id:                             a4f833bd-2055-4213-bfdd-ad21f95bf184
```

The key parts to pay attention to here are the `Status.Conditions.Status` field, which shows the progress of your rebalance request (if the proposal is not ready yet you may see `ProposalPending` as the `Status`) and the `Status.Optimization Result` which (once the proposal is ready) will show a summary of the optimization proposal. 
The meaning of each of these values is described in the [Strimzi documentation](https://strimzi.io/docs/operators/latest/using.html#con-optimization-proposals-str), essentially this summary shows you the scope of the changes that Cruise Control has suggested and from this you can figure out what kind of impact these changes may have on your cluster whilst they are being applied.

#### Interpreting an optimization proposal

In the case shown above, Cruise Control has suggested 55 partition replicas (totalling 12MB of data) should be move between separate brokers (_inter_-broker) in the cluster. 
This will involve moving data across the network, but 12MB is not a lot so this should not have too much of an impact. 
If this number was very high you may want to time this rebalance for a period of less load, as moving large amounts of data could effect the performance of the cluster as a whole. 

There are no _intra_ (between disks on the same broker) movements proposed. 
These kind of movements only involve movement between disks so have no network impact, but may effect the performance the particular brokers whose disks are exchanging data. 

Finally, this proposal is suggesting 24 leader replica changes. 
This is the cheapest change that can be applied as it only involves a configuration change in ZooKeeper.

### Starting a cluster rebalance

If you are happy with the proposal then you can apply an `approve` annotation to the `KafkaRebalance` resource to tell Cruise Control to start applying the changes:

```bash
$ kubectl annotate kafkarebalance my-rebalance strimzi.io/rebalance=approve -n myproject
```

It is important to note that if you wait a long time between asking for a proposal and approving it, the underlying cluster might be in a very different state to the time when you requested the proposal. 
In this case it is a good idea to _refresh_ the proposal, just to make sure it is up-to-date. You can do this by applying the `refresh` annotation to the `KafkaRebalance` resource:

```bash
$ kubectl annotate kafkarebalance my-rebalance strimzi.io/rebalance=refresh -n myproject
```

Once you apply an `approve` annotation Cruise Control will begin enacting the changes from that proposal. 
The Cluster Operator will keep the status of the `KafkaRebalance` resource up-to-date with the progress of the rebalance whilst it is ongoing. 
You can check this by running:

```bash
$ kubectl describe kafkarebalance my-rebalance -n myproject
```

Whilst the rebalance is in progress the Status will show `Rebalancing` and once it is finished it will show `Ready`.

```yaml
Name:         my-rebalance
Namespace:    myproject
Labels:       strimzi.io/cluster=my-cluster
Annotations:  API Version:  kafka.strimzi.io/v1alpha1
Kind:         KafkaRebalance
Metadata:
# ...
Status:
  Conditions:
    Last Transition Time:  2020-06-04T14:36:11.900Z
    Status:                Rebalancing
    Type:                  State
# ...
```

### Custom rebalance goals

In the `KafkaRebalance` example above we didn't specify any additional configurations, in that case Cruise Control generates the optimization proposal (or returns the cached proposal if it is ready) using the configured `default.goals`. 
It is also possible to specify a list of custom goals for each individual rebalance. 
This is so that you can request a rebalance focused on a specific set of goals, for example just making sure that CPU load is balanced. 
You can specify the goals in the `KafkaRebalance` resource:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaRebalance
metadata:
  name: my-rebalance
  labels:
    strimzi.io/cluster: my-cluster
spec:
  goals:
    - NetworkInboundCapacityGoal
    - DiskCapacityGoal
    - RackAwareGoal
    - NetworkOutboundCapacityGoal
    - CpuCapacityGoal
    - ReplicaCapacityGoal
```

When you ask for a rebalance with custom goals, Cruise Control will first check if the current cached optimization proposal already meets the list of custom goals you specified. 
If so, you will get your proposal back quickly. 
If not, you may have to wait a while for Cruise Control to perform the calculations.

One thing to watch out for here, is that your list of custom goals contains all the configured `hard.goals` (the default `hard.goals` are listed in [the docs](https://strimzi.io/docs/operators/latest/using.html#con-optimization-goals-str)). 
If it doesn't then Cruise Control will throw an error, after all why would you say these goals are _hard_ (really important) and then ignore them? 
But, if you really do only care about a few goals for this one off rebalance, you can tell Cruise Control to relax by adding `skipHardGoalCheck: true` to the `KafkaRebalance` resource.

### Stopping a rebalance

Rebalances can take a long time and may impact the performance of your cluster, therefore you may want to stop a rebalance if that is causing an issue. 
It is also possible that you may approve an optimization proposal that you later realise was not what you wanted. 
In either case, you need to be able to stop an ongoing rebalance. 
To do this you can apply the `stop` annotation to the `KafkaRebalance` resource at any time:

```bash
$ kubectl annotate kafkarebalance my-rebalance strimzi.io/rebalance=stop -n myproject
```

The status of the resource should then show `Stopped`. 
It is worth bearing in mind that Cruise Control batches changes to be passed to the Kafka Cluster, so whilst it will stop sending changes as soon as you apply the annotation, the Kafka Cluster may still be processing the last batch of changes.

## Conclusion

So, we have shown you what Cruise Control is, why you might want to use, what parts of it Strimzi supports and how to configure and use them. 
We are looking forward to people trying out the Cruise Control support and we are always open to questions and suggestions, so please [reach out to us](https://strimzi.io/community/). 

We are going to be adding more Cruise Control functionality in future so keep an eye on this blog for more updates. 

Happy rebalancing!
