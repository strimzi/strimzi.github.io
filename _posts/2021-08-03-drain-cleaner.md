---
layout: post
title:  "Drain Cleaner: what's this?"
date: 2021-08-03
author: federico_valeri
---

One of the promises of Kubernetes is zero downtime upgrades. If your service is highly available, meaning it has more 
than one replica running on different nodes or availability zones, then it should be possible to do a rolling update 
without any service disruption.

An event that may affect your service availability is the Kubernetes upgrade, where all nodes are drained one by one, 
until they are all running on the new version. Node draining is also used for maintenance. When a node is drained, all 
pods running on it are evicted and scheduled on other nodes. This process works well with stateless applications, but 
can cause issues when you have a stateful replicated application like Kafka.

<!--more-->

## Issue with Kubernetes upgrades

A common use case is a producer application sending records with `min.insync.replica=2` to a topic with 3 replicas, in 
order to get resiliency against single Kafka node failures. We want such client to be able to continue uninterrupted 
during a Kubernetes upgrade, where each node is drained right after the previous one has been fully evacuated.

The issue with Kafka and ZooKeeper pods is that the next node draining starts before the previous evacuated pod is fully 
synced, so it's likely that you end up with under-replicated partitions for some time, causing the producer's rate drop 
to zero. This may last from few seconds to several minutes, depending on the cluster load. In short, node draining 
feature does not account for the actual internal state of the Kafka cluster. This issue affects the entire data 
pipeline, so also consumers will likely be affected.

## Use the force (admission webhooks)

The [Drain Cleaner](https://github.com/strimzi/drain-cleaner) is a lightweight application that leverage admission 
webhooks to help moving Kafka pods from Kubernetes nodes which are being drained. This is useful if you want the Cluster 
Operator to move pods instead of Kubernetes itself. The advantage of this approach is that the Cluster Operator makes 
sure that no partition becomes under-replicated during node draining.

As you can see from the following image, when a new Kubernetes request arrives at the API server endpoint, a [Validating 
Admission Controller](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers) is 
invoked after the schema validation phase and it calls every registered webhook, which implement the decision logic. 
This can be useful to enforce custom policies or simply be notified about specific events.

![admission controllers](/assets/images/posts/2021-08-03-admission-controllers.png)

Some admission controllers are actually built-in (i.e. LimitRange, NamespaceLifecycle). Validating webhooks are safe, as 
they cannot change the incoming request and they always see the final version that would be persisted to etcd. Note that 
it may be disabled in your Kubernetes cluster for security reasons, so this is the first thing to verify.

In our case, we want the Drain Cleaner to be notified of all pod eviction requests. The application will then filter out 
all pods that are not part of our stateful sets. One important note is that Kafka CR must be configured with 
PodDisruptionBudget's `maxUnavailable: 0` in both Kafka and Zookeeper components. This is required to block 
Kubernetes draining and let the combined work of Drain Cleaner and Cluster Operator to handle this. 

This is how you can apply this configuration with a single patch command (no rolling update is needed):

```sh
kubectl patch kafka $CLUSTER_NAME --type json -p '[
  {
"op": "add",
"path": "/spec/zookeeper/template",
"value": {
  "podDisruptionBudget": {
    "maxUnavailable": 0
  }
}
},
  {
    "op": "add",
    "path": "/spec/kafka/template",
    "value": {
      "podDisruptionBudget": {
        "maxUnavailable": 0
      }
    }
  },
]'
```

## Validating webhook configuration

To register the Drain Cleaner's endpoint at the Kubernetes control-plane level, you need to create a 
ValidatingWebhookConfiguration resource. This is a simple REST endpoint, exposed under `/drainer` URL path. When an 
incoming request matches one of the specified operations, groups, versions, resources, and scope for any of defined 
rules, the request is sent to that endpoint.

```yaml
    rules:
      - apiGroups:   [""]
        apiVersions: ["v1"]
        operations:  ["CREATE"]
        resources:   ["pods/eviction"]
        scope:       "Namespaced"
    clientConfig:
      service:
        namespace: "strimzi-drain-cleaner"
        name: "strimzi-drain-cleaner"
        path: /drainer
        port: 443
      caBundle: $CA_BUNDLE
```

Here I used a placeholder for the PEM encoded CA bundle, which is required to validate the webhook's certificate. You 
can use a self-signed CA certificate, but the Drain Cleaner's end-entity certificate, signed by that CA, must have a 
common name (CN) that matches the application's service name.

Let's see how that CA bundle looks like for a self-signed example deployed on a test namespace (in the git repository, 
you can find detailed instructions on how to generate these certificates or let the platform do it for you):

```sh
# Self-signed CA certificate  
Certificate:
    Signature Algorithm: sha256WithRSAEncryption
        Issuer: C=IT, ST=Rome, O=Strimzi, CN=drain-cleaner-ca.strimzi.io
        Subject: C=IT, ST=Rome, O=Strimzi, CN=drain-cleaner-ca.strimzi.io
        X509v3 extensions:
            X509v3 Basic Constraints: critical
                CA:TRUE, pathlen:0

# Drain Cleaner's end-entity certificate         
Certificate:
    Signature Algorithm: sha1WithRSAEncryption
        Issuer: C=IT, ST=Rome, O=Strimzi, CN=drain-cleaner-ca.strimzi.io
        Subject: C=IT, ST=Rome, O=Strimzi, CN=drain-cleaner-webhook.strimzi.io
        X509v3 extensions:
            X509v3 Basic Constraints: critical
                CA:FALSE
            X509v3 Key Usage: 
                Digital Signature, Key Encipherment
            X509v3 Extended Key Usage: 
                TLS Web Server Authentication, TLS Web Client Authentication
            X509v3 Subject Alternative Name: 
                DNS:strimzi-drain-cleaner, 
                DNS:strimzi-drain-cleaner.test, 
                DNS:strimzi-drain-cleaner.test.svc, 
                DNS:strimzi-drain-cleaner.test.svc.cluster.local
```

## Let the magic happen

The Drain Cleaner must be deployed at the Kubernetes cluster level using a cluster-admin user, as we need to create a 
dedicated service account, cluster role and binding to allow reading pods resources. A single instance is able to handle 
all Kafka instances hosted on that Kubernetes cluster.

With the validating webhook configuration in place, the Drain Cleaner is notified as soon as something tries to evict 
Kafka or ZooKeeper pods and it annotates them with `strimzi.io/manual-rolling-update`. This tells the Cluster Operator 
that thy need to be restarted in the next reconciliation phase, making sure the Kafka cluster is always available. 
Restart annotation is not created if already present (idempotency) or the eviction request is running in dry-run mode.
Pod restart will be delayed if that would cause one or more partitions to be under-replicated. 

Once you have a Kafka cluster and the Drain Cleaner up and running, you can test it by draining one node hosting Kafka 
and/or Zookeeper pods with the following command:

```sh
kubectl drain $NODE_NAME --delete-emptydir-data --ignore-daemonsets --timeout=6000s --force
```

Looking at the Drain Cleaner's logs, you will see the eviction events being notified for all pods on that node. 
Only Kafka and Zookeeper pods are actually annotated for restart, all the rest is filtered out.

```
2021-08-03 08:07:00,218 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Received eviction webhook for Pod my-cluster-zookeeper-2 in namespace test
2021-08-03 08:07:00,218 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Pod my-cluster-zookeeper-2 in namespace test will be annotated for restart
2021-08-03 08:07:00,301 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Pod my-cluster-zookeeper-2 in namespace test found and annotated for restart

2021-08-03 08:07:01,508 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Received eviction webhook for Pod my-cluster-kafka-0 in namespace test
2021-08-03 08:07:01,508 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Pod my-cluster-kafka-0 in namespace test will be annotated for restart
2021-08-03 08:07:01,540 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Pod my-cluster-kafka-0 in namespace test found and annotated for restart
```

Given that the node being evacuated is cordoned (unschedulable), pods restart operated by the Cluster Operator in the 
next reconciliation phase will actually mov them away from that node.

```
2021-08-03 08:07:13 INFO  PodOperator:68 - Reconciliation #13(timer) Kafka(test/my-cluster): Rolling pod my-cluster-zookeeper-2
2021-08-03 08:08:06 INFO  PodOperator:68 - Reconciliation #13(timer) Kafka(test/my-cluster): Rolling pod my-cluster-kafka-0
2021-08-03 08:08:53 INFO  AbstractOperator:500 - Reconciliation #13(timer) Kafka(test/my-cluster): reconciled
```

Once you are finished, don't forget to make that node schedulable again:

```sh
kubectl uncordon $NODE_NAME
```

## Conclusion

The Drain Cleaner is a lightweight application that runs as a singleton service on your Kubernetes cluster. With a small 
overhead you can guarantee high availability for all your Kafka clusters. This is especially important when you have service 
level agreements (SLA) in place that you want to fulfill. This is a new component that recently joined the Strimzi family 
and it is supported since 0.21.0 release. For that reason, there are plenty of opportunities for contributions.
