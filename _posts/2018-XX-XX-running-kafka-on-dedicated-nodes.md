---
layout: post
title:  "Running Kafka on dedicated Kubernetes nodes"
date: 2018-XX-XX
author: jakub_scholz
---

When running applications on OpenShift or Kubernetes, different pods get colocated on the same nodes.
That is a very useful, because it helps to decrease costs by better utilizing the available hardware.
But it can also cause some issues.
One of them are for example _noisy neighbors_.
A situation when multiple applications which are intensively utilizing the same resource - for example network bandwidth or disk I/O - meet on the same node.
How do you avoid such problems when running Apache Kafka on OpenShift or Kubernetes with Strimzi?
And how do you make sure your Apache Kafka delivers the best performance?

<!--more-->

Most Apache Kafka users want from their clusters the best possible performance.
Good performance does not only mean that most messages are delivered with super low latency or super high throughput.
It also means that the performance of the cluster is constant in time and without any significant spikes.
_Noisy neighbors_ are just one possible cause of performance issues.

There are several ways how to get the best out of Apache Kafka:

* Make sure Kafka pods are not scheduled on the same node as other performance intensive applications
* Make sure Kafka pods are scheduled on the nodes with the most suitable hardware
* Use nodes which are dedicated to Kafka only

Since the 0.5.0 release, Strimzi supports all of these.
This blog post will show you how to use them.

# Pod Anti-Affinity

[Pod affinity and anti-affinity](https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#affinity-and-anti-affinity) is a Kubernetes feature which allows you to specify constrains for pod scheduling.
It allows users to specify whether the pod should be scheduled on the same node (affinity) as other pod or on a different node (anti-affinity).
The pods which should be included into the scheduling constrain are specified using a label selector.
The scheduling could be either preferred or required.
The preferred scheduling defines a soft constrain - it will give you only best effort guarantee.
When there is no way schedule the pod according to the constrain, the pod will be scheduled in a way which doesn't match the constrain.
The required scheduling is sets a hard constrain.
If the constrain cannot be met, the pod will not be scheduled.

Strimzi supports pod affinity for Kafka, Zookeeper and Kafka Connect.
You can use it to specify the pods which should never run on the same node as Kafka pods.
Affinity can be specified in the Custom Resources (CR) under the `affinity` key.

The typical workload which you want to avoid sharing the node with are other applications whcih are network or disk I/O intensive.
Such as for example databases.
The example below shows an example of an Kafka CR with pod anti-affinity specified.
It will require Kubernetes to schedule the Kafka pods on node where there are no other pods with labels `application=postgresql` or `application=mongodb`.
The rule can be easily adapted to include also other applications or different labels.
The `topologyKey` field specifies that the pods matching the selector should not be sharing the same hostname - which means they will be scheduled on different nodes.

```
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    ...
    affinity:
      podAntiAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
                - key: application
                  operator: In
                  values:
                    - postgresql
                    - mongodb
          topologyKey: "kubernetes.io/hostname"
    ...
  zookeeper:
    ...
```

Since the example is using `requiredDuringSchedulingIgnoredDuringExecution` constrain (the required scheduling), you have to make sure that your cluster has enough different nodes to accomodate all pods with different scheduling requirements.
Or you can switch to using `preferredDuringSchedulingIgnoredDuringExecution` constrain which will schedule the pods more flexibly.

# Node affinity

_Not all nodes are born equal._
It is quite common that a big Kubernetes or OpenShift cluster consists of many different types of nodes.
Some are optimized for CPU heavy workloads, some for memory while other might be optiomised for storage (fast local SSDs) or network.
Using different nodes helps to optimize both costs and performance.
But as a user of such heterogenius cluster you need to be able to schedule your workloads to the right node.

To schedule workloads onto specific nodes, Kubernetes have a feature called [node affinity](https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#affinity-and-anti-affinity).
Node affinity allows you to create a scheduling constrain for the node on which the pod will be scheduled.
The constrain is once again specified as label selector.
You can either use it for the built-in node label such as `beta.kubernetes.io/instance-type`.
Or you can use your own labels to select the right node.

Node affinitiy can be also specified in the `affinity` field of our custom resources for Kafka, Zookeeper and Kafka Connect.
The example below shows configuration which will ensure that Kafka pods will be scheduled only on nodes with label `node-type` is equal to `fast-network`.

```
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    ...
    affinity:
      nodeAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          nodeSelectorTerms:
            - matchExpressions:
              - key: node-type
                operator: In
                values:
                - fast-network
    ...
  zookeeper:
    ...
```

When needed, you can also combine node affinity together with pod affinity:

```
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    ...
    affinity:
      nodeAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          nodeSelectorTerms:
            - matchExpressions:
              - key: node-type
                operator: In
                values:
                - fast-network
      podAntiAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
                - key: application
                  operator: In
                  values:
                    - postgresql
                    - mongodb
          topologyKey: "kubernetes.io/hostname"
    ...
  zookeeper:
    ...
```

# Dedicated nodes

The ultimate solution is to create dedicated nodes.
With dedicated nodes you can make sure that there will be only Kafka pods and system services such as log collectors or software defined networks sharing the node.
There will be no other pods scheduled on such machine which could affect or disturb the performance of the Kafka brokers.

To create a dedicated node, you have to first _taint_ it.
[Taints](https://kubernetes.io/docs/concepts/configuration/taint-and-toleration/) are a feature of nodes which can be used to repel pods.
Only pods which tolerate given taint can be scheduled on such node.
The nodes can be tainted using the `kubectl` tool:

```
$ kubectl taint nodes ip-10-0-0-124.ec2.internal dedicated=Kafka:NoSchedule
node "ip-10-0-0-124.ec2.internal" tainted
```

The taint has always a key, value and effect.
In the exampe above, the key is `dedicated`, the value is `kafka` and the effect is `NoSchedule`.
Setting this taint will make sure that regular pods will be scheduled to the tainted node.
If you have any cluster wide services running as pods (such as Fluentd DeamonSets for collecting logs) you have to make sure that they will tolerate the taint as well. Otherwise you will have no logs from your Kafka pods.

The [Toleration](https://kubernetes.io/docs/concepts/configuration/taint-and-toleration/) for the Kafka pods is configured in the custom resource with the key `toleration`.
It is supported for Kafka, Zookeeper and Kafka Connect.
But setting the toleration is not enough.
Toleration tells Kubernetes that the pod can be scheduled on the tainted node.
It doesn't say that the pods couldn't be scheduled anyhwere else.
So we need to combine the toleration with node affinity to make sure that the node will be scheduled only on the dedicatd node.
To do that we need to label the dedicated node as well, so that we can use the label in the node affinity selector:

```
$ kubectl label nodes ip-10-0-0-124.ec2.internal dedicated=Kafka
node "ip-10-0-0-124.ec2.internal" labeled
```

Once the taint and the label are set, we can deploy the Kafka cluster.
The example below shows a Kafka custom resource which configures the matching toleraton and node selector.

```
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    ...
    tolerations:
      - key: "dedicated"
        operator: "Equal"
        value: "Kafka"
        effect: "NoSchedule"
    affinity:
      nodeAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          nodeSelectorTerms:
          - matchExpressions:
            - key: dedicated
              operator: In
              values:
              - Kafka
    ...
  zookeeper:
    ...
```

This will make sure that only the KAfka pods will be running on the dedicated nodes.

## Practical example

To show in detail how the dedicated nodes work, I deployed a 3 node KAfka cluster into my Kubernetes cluster running in AWS.
My Kubernetes cluster had 1 master node and 6 worker nodes:

```
$ kubectl get nodes -o wide
NAME                         STATUS    ROLES     AGE       VERSION   EXTERNAL-IP      OS-IMAGE                KERNEL-VERSION              CONTAINER-RUNTIME
ip-10-0-0-124.ec2.internal   Ready     <none>    7m        v1.10.5   34.238.153.57    CentOS Linux 7 (Core)   3.10.0-862.3.2.el7.x86_64   docker://18.6.0
ip-10-0-0-236.ec2.internal   Ready     <none>    33s       v1.10.5   54.152.210.78    CentOS Linux 7 (Core)   3.10.0-862.3.2.el7.x86_64   docker://18.6.0
ip-10-0-0-60.ec2.internal    Ready     master    7m        v1.10.5   35.171.124.109   CentOS Linux 7 (Core)   3.10.0-862.3.2.el7.x86_64   docker://18.6.0
ip-10-0-1-115.ec2.internal   Ready     <none>    7m        v1.10.5   107.23.251.223   CentOS Linux 7 (Core)   3.10.0-862.3.2.el7.x86_64   docker://18.6.0
ip-10-0-1-18.ec2.internal    Ready     <none>    35s       v1.10.5   54.152.8.252     CentOS Linux 7 (Core)   3.10.0-862.3.2.el7.x86_64   docker://18.6.0
ip-10-0-2-31.ec2.internal    Ready     <none>    7m        v1.10.5   184.72.149.131   CentOS Linux 7 (Core)   3.10.0-862.3.2.el7.x86_64   docker://18.6.0
ip-10-0-2-61.ec2.internal    Ready     <none>    55s       v1.10.5   54.209.246.85    CentOS Linux 7 (Core)   3.10.0-862.3.2.el7.x86_64   docker://18.6.0
```

I picked 3 nodes on which I set the taints and labels:

```
$ kubectl taint nodes ip-10-0-0-124.ec2.internal dedicated=Kafka:NoSchedule
node "ip-10-0-0-124.ec2.internal" tainted
$ kubectl taint nodes ip-10-0-1-115.ec2.internal dedicated=Kafka:NoSchedule
node "ip-10-0-1-115.ec2.internal" tainted
$ kubectl taint nodes ip-10-0-2-31.ec2.internal dedicated=Kafka:NoSchedule
node "ip-10-0-2-31.ec2.internal" tainted
$ kubectl label nodes ip-10-0-0-124.ec2.internal dedicated=Kafka
node "ip-10-0-0-124.ec2.internal" labeled
$ kubectl label nodes ip-10-0-1-115.ec2.internal dedicated=Kafka
node "ip-10-0-1-115.ec2.internal" labeled
$ kubectl label nodes ip-10-0-2-31.ec2.internal dedicated=Kafka
node "ip-10-0-2-31.ec2.internal" labeled
```

As a result, the cluster has 3 dedicated nodes for Kafka andf 3 nodes for Zookeeper, Strimzi operators and Kafka clients.
Now we can deploy the Strimzi Cluster Operator which is scheduled on one of the nodes which are not dedicated to Kafka:

```
$ kubectl get pods -o wide
NAME                                        READY     STATUS    RESTARTS   AGE       IP                NODE
strimzi-cluster-operator-586d499cd7-bzqsg   1/1       Running   0          1m        192.168.29.1      ip-10-0-2-61.ec2.internal
```

With the Cluster Operator running, Kafka can be deployed using following resource:

```
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    replicas: 3
    readinessProbe:
      initialDelaySeconds: 15
      timeoutSeconds: 5
    livenessProbe:
      initialDelaySeconds: 15
      timeoutSeconds: 5
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
    tolerations:
      - key: "dedicated"
        operator: "Equal"
        value: "Kafka"
        effect: "NoSchedule"
    storage:
      type: ephemeral
    rack:
      topologyKey: "failure-domain.beta.kubernetes.io/zone"
    affinity:
      nodeAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          nodeSelectorTerms:
          - matchExpressions:
            - key: dedicated
              operator: In
              values:
              - Kafka
    logging:
      type: inline
      loggers:
        log4j.rootLogger: INFO
        #log4j.logger.kafka.authorizer.logger: INFO
  zookeeper:
    replicas: 3
    readinessProbe:
      initialDelaySeconds: 15
      timeoutSeconds: 5
    livenessProbe:
      initialDelaySeconds: 15
      timeoutSeconds: 5
    storage:
      type: ephemeral
   logging:
     type: inline
     loggers:
       zookeeper.root.logger: INFO
  topicOperator:
    logging:
      type: inline
      loggers:
        rootLogger.level: INFO
```

Cluster Operator will deploy the StatfulSets for Zookeeper and Kafka as well as the Topic Operator.
But only the Kafka pods will be scheduled to the dedicated nodes:

```
$ kubectl get pods -o wide
NAME                                        READY     STATUS    RESTARTS   AGE       IP                NODE
my-cluster-kafka-0                          2/2       Running   0          2m        192.168.158.65    ip-10-0-1-115.ec2.internal
my-cluster-kafka-1                          2/2       Running   0          2m        192.168.221.65    ip-10-0-2-31.ec2.internal
my-cluster-kafka-2                          2/2       Running   0          2m        192.168.226.67    ip-10-0-0-124.ec2.internal
my-cluster-topic-operator-fb6cb47d-qqjrz    2/2       Running   0          1m        192.168.180.194   ip-10-0-1-18.ec2.internal
my-cluster-zookeeper-0                      2/2       Running   0          2m        192.168.180.193   ip-10-0-1-18.ec2.internal
my-cluster-zookeeper-1                      2/2       Running   0          2m        192.168.17.65     ip-10-0-0-236.ec2.internal
my-cluster-zookeeper-2                      2/2       Running   0          2m        192.168.29.2      ip-10-0-2-61.ec2.internal
strimzi-cluster-operator-586d499cd7-bzqsg   1/1       Running   0          9m        192.168.29.1      ip-10-0-2-61.ec2.internal
```