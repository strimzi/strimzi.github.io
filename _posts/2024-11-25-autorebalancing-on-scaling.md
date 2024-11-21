---
layout: post
title:  "Auto-rebalancing on cluster scaling"
date: 2024-11-25
author: paolo_patierno
---

Scaling an Apache Kafka cluster up or down can help meet various goals and deliver multiple benefits.
Scaling up by adding new brokers enables the cluster to handle a higher data load across clients.
Scaling down by removing brokers can reduce costs and energy consumption when demand is lower.
But scaling the cluster makes more sense if it's done automatically, for example by leveraging the HPA (Horizontal Pod Autoscaler) within Kubernetes.
After scaling up, the issue arises from the cluster being unbalanced, with new brokers left empty.
This requires rebalancing topic partitions to equally spread the load across all brokers, old and new.
On the other hand, scaling down may not be possible if the brokers to be removed host topic partitions, unless we are willing to accept offline replicas and sacrifice High Availability (HA).
In both scenarios, rebalancing the cluster by using the Cruise Control integration within Strimzi is the solution.
Doing it automatically makes the process even easier and this is what we are going to talk about in this blog post.

<!--more-->

### How scaling and rebalancing is done today

When scaling up a Kafka cluster, newly added brokers don't get any partitions for the topics hosted on the other brokers.
The new brokers remain empty and will receive partitions for newly created topics based on Apache Kafka's distribution mechanism.
Quite often, this is not what you want because you are scaling up in order to spread the load across more brokers and to get better performance.
Currently, the only way to achieve this with Strimzi is by manually rebalancing the cluster using the `KafkaRebalance` custom resource in `add-brokers` mode, where you list the added brokers and specify the goals to be met by Cruise Control.
This way, some of the already existing topic partitions are moved from the old brokers to the new ones, making the cluster more balanced.

When scaling down, the operation to remove brokers could be blocked by the Cluster Operator because those brokers are hosting topic partitions and the immediate shutdown will cause offline replicas and loss of HA.
In order to move forward, before scaling down, it is possible to run a manual rebalancing by using a `KafkaRebalance` custom resource with the `remove-brokers` mode (listing the brokers to remove) and the goals for that.
This way, Cruise Control moves partitions off the brokers to be removed so that they become empty and can be scaled down.

For more details about how to do this, please refer to the official [documention](https://strimzi.io/docs/operators/latest/deploying#cruise-control-concepts-str) related to the Cruise Control integration within Strimzi.

While both the above approaches work, the process is still actually manual and done in two separate steps:

* scale the cluster up, then run a rebalancing by using the `add-brokers` mode.
* run a rebalancing by using the `remove-brokers` mode, then scale the cluster down.

What if it could be possible to automate such a process?
What about having the Cluster Operator running a rebalance right after a scale up operation, or right before scaling down the cluster?
The new Strimzi 0.44.0 release brings to you the new auto-rebalancing on cluster scaling feature!

### The auto-rebalancing on scaling feature to the rescue!

Enabling auto-rebalancing is totally configurable through the new `autoRebalance` property within the `cruiseControl` section in the `Kafka` custom resource.

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
Using the `KafkaRebalance` custom resource as a template is a way to make the lives of Strimzi users easier because they already know how it works in regards to integration with Cruise Control.
There isn't anything new to learn beyond applying the template annotation and not specifying fields like `mode` and `brokers` because they will be set automatically by the Strimzi operator when running the auto-rebalancing.
Indeed, when an auto-rebalancing has to run, the Cluster Operator starts from the template and creates an actual `KafkaRebalance` custom resource by using that configuration and adding the right `mode` and `brokers` properties.

In the following shell snippet, you can see the `KafkaRebalance` resources involved in two auto-rebalancing operations.
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

If you want to see the auto-rebalancing in action together with cluster auto-scaling, you can watch the KubeCon NA 2025 session, [Elastic Data Streaming: Autoscaling Apache Kafka](https://www.youtube.com/watch?v=pj6eLTC2tv8), delivered by Jakub Scholz.

<iframe width="560" height="315" src="https://www.youtube.com/watch?v=pj6eLTC2tv8" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

### Conclusion

Scaling an Apache Kafka cluster plays an important role in getting better performance on one side and saving costs and energy consumption on the other side.
But just scaling can't bring all the advantages by itself and it needs to be supported by a rebalancing process in order to get a more balanced cluster to spread the load across all the brokers.
Having an automatic mechanism to do so is the key for making your cluster capable of scaling more elastically, as also demonstrated by Jakub Scholz in this [video](https://www.youtube.com/watch?v=b8JZpom-67I).
We hope this new feature proves useful for Strimzi users, and we encourage you to try it out.
A better integration between Kafka an Cruise Control is one of the long-term goals of the Strimzi project that would allow a sort of Kafka auto pilot mode, and this is a significant step in that direction.
Please let us know how it works, any issues you encounter, or any suggestions you may have.
Looking forward to hearing from our beloved community!
