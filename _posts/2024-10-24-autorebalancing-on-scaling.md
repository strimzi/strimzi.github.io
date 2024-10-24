---
layout: post
title:  "Autorebalancing on cluster scaling"
date: 2024-10-24
author: paolo_patierno
---

Scaling up or down an Apache Kafka cluster is usually done in order to achieve different goals and to get several benefits.
When scaling up, by adding new brokers, the cluster is capable to handle more load in terms of data transmitted across clients.
When scaling down, by removing some brokers from the cluster, we are able to reduce costs and energy consumption when there is not that much demand for performance due to a lower load.
But scaling the cluster makes more sense if it's done automatically, for example by leveraging the HPA (Horizontal Pod Autoscaler) within Kubernetes.
The problem comes when, after scaling up, the cluster is not balanced and the newly added brokers are just empty and there is the need to rebalance topics' partitions to equally spread the load across all the brokers (older and newer).
On the other side, scaling down could be not possible when brokers to be removed are hosting topics' partitions, unless we accept to have offline replicas and losing HA (High Availability).
In both scenarios, rebalancing the cluster by using the Cruise Control integration within Strimzi is the solution.
Doing it automatically is even better and this is what we are going to talk about in this blog post.

<!--more-->

### Scaling and rebalancing, how do you do today?

When scaling up an Apache Kafka cluster, the newly added brokers don't get any partitions of the already existing topics hosted on the other brokers.
The new brokers are just empty and they are going to get partitions for newly created topics based on the distribution mechanism within Apache Kafka itself.
Quite often, this is not what you want because you are scaling up in order to spread the load across more brokers and getting better performance.
Today, the only way to do so with Strimzi, is about running a manual rebalancing by leveraging the `KafkaRebalance` custom resource with the `add-brokers` mode (listing the added brokers) and the goals to be satisfied by Cruise Control.
This way, some of the already existing topics' partitions are moved from the old brokers to the new ones, making the cluster more balanced.

When scaling down, the operation of removing brokers could be blocked by the Strimzi operator because those brokers are hosting topics' partitions and the immediate shutdown will cause offline replicas and losing HA.
In order to move forward, before scaling down, it is possible to run a manual rebalancing by using a `KafkaRebalance` custom resource with the `remove-brokers` mode (listing the brokers to remove) and the goals for that.
This way, Cruise Control moves partitions off the brokers to be removed so that they become empty and can be scaled down.

For more details about how to do so, please refer to the official [documention](https://strimzi.io/docs/operators/latest/deploying#cruise-control-concepts-str) related to the Cruise Control integration within Strimzi. 

While both the above approaches work, the process is still actually manual and done in two separate steps:

* scale the cluster up, then run a rebalancing.
* run a rebalancing, then scale the cluster down.

What if it could be possible to automate such a process?
What about having the Strimzi operator running a rebalance right after the scale up operation, or right before the attempt of scaling down the cluster?
The new Strimzi 0.44.0 release brings to you the new auto-rebalancing on cluster scaling feature!

### The auto-rebalancing on scaling feature to the rescue!

Enabling the auto-rebalancing is totally configurable through the new `autoRebalance` property within the `cruiseControl` section in the `Kafka` custom resource.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
  cruiseControl:
    # ...
    autoRebalance:
      - mode: add-brokers
        template:
          name: my-add-brokers-rebalancing-template
      - mode: remove-brokers
        template:
          name: my-remove-brokers-rebalancing-template
```

From the example above, within the `autoRebalance` section, the user can specify "when" the auto-rebalancing has to run: on scaling up (by using the `add-brokers` mode) and/or on scaling down (by using the `remove-broker` mode).
It is not mandatory to have them both; you can decide to have auto-rebalancing on scaling up but not on scaling down and vice versa.
For each mode, it is possible to specify the name of a rebalancing configuration "template".
This is just a `KafkaRebalance` custom resource with the new `strimzi.io/rebalance-template: true` annotation applied, which makes it a configuration template to be used during auto-rebalancing operations and not an actual rebalance request to run.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaRebalance
metadata:
  name: my-rebalance-template
  annotations:
    strimzi.io/rebalance-template: "true" # specifies that this KafkaRebalance is a rebalance configuration template
spec:
  # NOTE: mode and brokers fields, if set, will be just ignored because they are
  #       automatically set on the corresponding KafkaRebalance by the operator
  goals:
    - CpuCapacityGoal
    - NetworkInboundCapacityGoal
    - DiskCapacityGoal
    - RackAwareGoal
    - MinTopicLeadersPerBrokerGoal
    - NetworkOutboundCapacityGoal
    - ReplicaCapacityGoal
  skipHardGoalCheck: true
  # ... other rebalancing related configuration
```

The configuration template can be the same for both scaling operations or the user can decide to use different ones.
Using the `KafkaRebalance` custom resource is a way to make lives easier to the Strimzi users because they already know how it works in regards the integration with Cruise Control.
There isn't anything new to learn but just applying the template annotation and not specifying fields like `mode` and `brokers` because they will be set automatically by the Strimzi operator when running the auto-rebalancing.
Indeed, when an auto-rebalancing has to run, the Strimzi operator starts from the template and create an actual `KafkaRebalance` custom resource by using that configuration and adding the right `mode` and the `brokers`.

In the following shell snippet you can see the `KafkaRebalance` resources involved in two auto-rebalancing operations. 
The first one is about scaling up and the next one is about scaling down.
It shows how the `KafkaRebalance` resources go through the usual states when the operator interacts with Cruise Control for running the rebalancing.

```shell
NAME                                            CLUSTER      TEMPLATE   STATUS
my-add-brokers-rebalancing-template             my-cluster   true       
my-remove-brokers-rebalancing-template          my-cluster   true       
...
my-cluster-auto-rebalancing-add-brokers         my-cluster              PendingProposal
my-cluster-auto-rebalancing-add-brokers         my-cluster              ProposalReady
my-cluster-auto-rebalancing-add-brokers         my-cluster              Rebalancing
my-cluster-auto-rebalancing-add-brokers         my-cluster              Ready
...
...
my-cluster-auto-rebalancing-remove-brokers      my-cluster              ProposalReady
my-cluster-auto-rebalancing-remove-brokers      my-cluster              Rebalancing
my-cluster-auto-rebalancing-remove-brokers      my-cluster              Ready
```

It is also possible to get the auto-rebalancing progress from the `status` section within the `Kafka` custom resource as well as from the specific `KafkaRebalance` instance created by the operator of course.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
  cruiseControl:
    # ...
    autoRebalance:
      # ...
status:
  autoRebalance:
    lastTransitionTime: "2024-10-24T10:46:10.759494479Z"
    modes:
    - brokers:
      - 6
      - 7
      mode: remove-brokers
    state: RebalanceOnScaleUp
```

If you want to see the auto-rebalancing in action, you can watch this [video](https://www.youtube.com/watch?v=u6qHPL-VXRE) published on the official Strimzi YouTube channel.

### Conclusion

Scaling an Apache Kafka cluster plays an important role to get better performance on one side and save costs and energy consumption on the other side.
But just scaling can't bring all the advantages by itself and it needs to be supported by a rebalancing process in order to get a more balanced cluster to spread the load across all the brokers.
Having an automatic mechanism to do so is the key for making your cluster able to scale more elastically, as also demonstrated by Jakub Scholz in this [video](https://www.youtube.com/watch?v=b8JZpom-67I).
We hope that this new feature is going to be useful to the Strimzi users, so we invite you all to try it out and let us know how it works, if there are any issues to address or if you have any suggestions for us.
Looking forward to hear from our beloved community!
