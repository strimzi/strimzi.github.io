---
layout: post
title:  "Drain Cleaner: what's this?"
date: 2021-08-03
author: federico_valeri
---

One of the promises of Kubernetes is zero downtime upgrades. If your service is highly available, meaning it has more than 
one replica running on different nodes or availability zones, then it should be possible to do a rolling update without 
any service disruption. 

An event that may affect your service availability is the Kubernetes upgrade, where all nodes are drained one by one, until 
they are all running on the new version. Node draining is also used for maintenance. When a node is drained, all pods running 
on it are evicted and scheduled to other nodes. This process works well with stateless applications, but can cause issues 
when you have a stateful replicated application like Kafka.

<!--more-->

## Issue with Kubernetes upgrades

A common use case is a producer application sending records with `min.insync.replica=2` in order to get resiliency against 
a single Kafka node failure. We want such clients to be able to continue uninterrupted during a Kubernetes upgrade, where 
each node is drained right after the previous one has been fully evacuated.

In case of Kafka or ZooKeeper pods, the next node draining starts before the previous evacuated pod is fully synced, so 
it's likely that you end up with under-replicated partitions for some time, causing the producer's rate drop to zero. 
This may last from few seconds to several minutes, depending on the actual load. In short, node draining feature does not 
account for the actual internal state of the Kafka cluster. This issue affects the entire data pipeline, so also consumer 
applications will likely be affected.

## Use the force (admission webhooks)

The [Drain Cleaner](https://github.com/strimzi/drain-cleaner) is a lightweight application which leverage admission webhooks 
to help moving Kafka pods from Kubernetes nodes which are being drained. This is useful if you want the Cluster Operator 
to move the pods instead of Kubernetes itself. The advantage of this approach is that the Cluster Operator makes sure that 
no pods become under-replicated during nodes draining.

As you can see from the following image, when a new Kubernetes request arrives at the API server endpoint, a [Validating 
Admission Controller](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers) is invoked 
after the schema validation phase and it calls every registered webhook, which implement the decision logic. This can be 
useful to enforce custom policies or simply be notified of specific events.

![admission controllers](/assets/images/posts/2021-08-03-admission-controllers.png)

Some admission controllers are actually built-in (i.e. LimitRange, NamespaceLifecycle). Validating webhooks are safe, as 
they cannot change the incoming request and they always see the final version that would be persisted to etcd. Note that 
it may be disabled in your cluster for security reasons, so this is the first thing to verify.

In our case, we want our Drain Cleaner to be notified of all pod eviction requests. The application will then filter out 
all pods that are not part of Kafka and ZooKeeper stateful set (this is configurable). One important note is that Kafka 
CR must be configured with PodDisruptionBudget (PDB) `maxUnavailable: 0` for both Kafka and Zookeeper components, in order 
to block Kubernetes node draining and let the combined work of the Drain Cleaner and the Cluster Operator to handle this. 
This is a simple PDB configuration change and no rolling update is required.

```yaml
    template:
      podDisruptionBudget:
        maxUnavailable: 0
```

## Validating webhook configuration

All starts with creating a ValidatingWebhookConfiguration resource, which registers a webhook endpoint at the Kubernetes 
cluster control-plane level. This is a simple REST endpoint, exposed by the Drain Cleaner application under `/drainer` URL. 
When an incoming request matches one of the specified operations, groups, versions, resources, and scope for any of defined 
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

Here I used a placeholder for the PEM encoded CA bundle, which is required to validate the webhook's certificate. You can 
use a self-signed CA certificate, but the Drain Cleaner's end-entity certificate must have a common name (CN) that matches 
the service name, in our case `strimzi-drain-cleaner.$NAMESPACE.svc`. Using OpenShit or the CertManager you can have that 
certificate automatically injected (see examples in the repository), but let's do it manually to see how it works.

```sh
DOMAIN="strimzi.io"
PASSWORD="changeit"
NAMESPACE="test"
SERVICE="strimzi-drain-cleaner"

BASE="
[req]
prompt=no
distinguished_name=dn
x509_extensions=ext
[dn]
countryName=IT
stateOrProvinceName=Rome
organizationName=Strimzi
"

# generate CA certificate
CA_SUBJECT="drain-cleaner-ca"
CA_CONFIG="
$BASE
commonName=$CA_SUBJECT.$DOMAIN
[ext]
basicConstraints=critical,CA:true,pathlen:0
"
openssl genrsa -out $CA_SUBJECT.key 4096
openssl req -new -x509 -days 3650 -key $CA_SUBJECT.key -out $CA_SUBJECT.crt -config <(echo "$CA_CONFIG")

# generate and sign webhook certificate
WH_SUBJECT="drain-cleaner-webhook"
WH_CONFIG="
$BASE
commonName=$WH_SUBJECT.$DOMAIN
[ext]
basicConstraints=critical,CA:false
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=@san
[san]
DNS.1=$SERVICE
DNS.2=$SERVICE.$NAMESPACE
DNS.3=$SERVICE.$NAMESPACE.svc
DNS.4=$SERVICE.$NAMESPACE.svc.cluster.local
"
openssl genrsa -out $WH_SUBJECT.key 2048
openssl req -new -key $WH_SUBJECT.key -out $WH_SUBJECT.csr -config <(echo "$WH_CONFIG")
openssl x509 -req -days 3650 -in $WH_SUBJECT.csr -CA $CA_SUBJECT.crt -CAkey $CA_SUBJECT.key \
    -CAcreateserial -out $WH_SUBJECT.crt -extensions ext -extfile <(echo "$WH_CONFIG")

# create webhook bundle
WEBHOOK_CER=$(base64 $WH_SUBJECT.crt)
WEBHOOK_KEY=$(base64 $WH_SUBJECT.key)
CA_BUNDLE=$(cat $WH_SUBJECT.crt $CA_SUBJECT.crt | base64 -i -)
```

## Let the magic happen

The Drain Cleaner must be deployed at the cluster level using a cluster-admin user, as we need to create a dedicated service 
account, cluster role and binding to allow reading pods resources. A single instance is able to handle all Kafka instances 
hosted on that Kubernetes cluster.

With the validating webhook configuration in place, the Drain Cleaner is notified as soon as something tries to evict Kafka 
or ZooKeeper pods and it annotates them with the `strimzi.io/manual-rolling-update`. This tells the Cluster Operator that 
thy need to be restarted in the next reconciliation phase, making sure the Kafka cluster is always available, with no 
under-replicated partitions. That annotation is not created when it is already present (idempotency) or the eviction
request is in dry-run mode.

Below, you can find an example from scratch, that you can easily reproduce on a multi node cluster with a sufficient number 
of schedulable nodes. We deploy a test Kafka cluster and then drain one of the nodes to verify that the Drain Cleaner is 
notified and the Cluster Operator actually restarts the affected pods.

```sh
NAMESPACE="test"
VERSION="0.24.0"
OPERATOR_URL="https://github.com/strimzi/strimzi-kafka-operator/releases/download/$VERSION/strimzi-cluster-operator-$VERSION.yaml"
RELEASE=$(printf "$VERSION" | sed -r 's/(.*)\..+/release-\1.x/')

# deploy kafka cluster
kubectl create ns $NAMESPACE
kubectl config set-context --current --namespace=$NAMESPACE
curl -L $OPERATOR_URL | sed "s/namespace: .*/namespace: $NAMESPACE/g" | kubectl replace --force -f -
kubectl create -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/$RELEASE/packaging/examples/kafka/kafka-persistent.yaml
kubectl patch kafka my-cluster --type json -p '[
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

# deploy drain cleaner
git clone https://github.com/strimzi/drain-cleaner.git && cd drain-cleaner
mv packaging/install/kubernetes/000-Namespace.yaml packaging/install/kubernetes/000-Namespace.yaml.bk
sed -i.bk "s/namespace: .*/namespace: $NAMESPACE/g" packaging/install/kubernetes/*.yaml
sed -i.bk "s/tls.crt: .*/tls.crt: $CA_BUNDLE/g" packaging/install/kubernetes/040-Secret.yaml
sed -i.bk "s/tls.key: .*/tls.key: $WEBHOOK_KEY/g" packaging/install/kubernetes/040-Secret.yaml
sed -i.bk "s/caBundle: .*/caBundle: $CA_BUNDLE/g" packaging/install/kubernetes/070-ValidatingWebhookConfiguration.yaml
kubectl create -f packaging/install/kubernetes

# watch pods logs
watch "kubectl get pods -o wide"
kubectl logs $(kubectl get pods | grep cluster-operator | awk '{print $1}') -f
kubectl logs $(kubectl get pods | grep drain-cleaner | awk '{print $1}') -f

# drain node
KAFKA0_NODE=$(kubectl get pod my-cluster-kafka-0 -o wide --no-headers | awk '{print $7}')
kubectl drain $KAFKA0_NODE --delete-emptydir-data --ignore-daemonsets --timeout=6000s --force

# final cleanup
kubectl uncordon $KAFKA0_NODE
kubectl delete ns $NAMESPACE
kubectl delete validatingwebhookconfiguration strimzi-drain-cleaner
kubectl delete clusterrolebinding strimzi-drain-cleaner
kubectl delete clusterrole strimzi-drain-cleaner
kubectl delete $(kubectl get crd -l app=strimzi -o name)
```

Drain Cleaner logs:

```
2021-08-03 08:07:00,218 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Received eviction webhook for Pod my-cluster-zookeeper-2 in namespace test
2021-08-03 08:07:00,218 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Pod my-cluster-zookeeper-2 in namespace test will be annotated for restart
2021-08-03 08:07:00,301 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Pod my-cluster-zookeeper-2 in namespace test found and annotated for restart

2021-08-03 08:07:01,508 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Received eviction webhook for Pod my-cluster-kafka-0 in namespace test
2021-08-03 08:07:01,508 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Pod my-cluster-kafka-0 in namespace test will be annotated for restart
2021-08-03 08:07:01,540 INFO  [io.str.ValidatingWebhook] (executor-thread-17) Pod my-cluster-kafka-0 in namespace test found and annotated for restart
```

Cluster Operator logs:

```
2021-08-03 08:07:13 INFO  PodOperator:68 - Reconciliation #13(timer) Kafka(test/my-cluster): Rolling pod my-cluster-zookeeper-2
2021-08-03 08:08:06 INFO  PodOperator:68 - Reconciliation #13(timer) Kafka(test/my-cluster): Rolling pod my-cluster-kafka-0
2021-08-03 08:08:53 INFO  AbstractOperator:500 - Reconciliation #13(timer) Kafka(test/my-cluster): reconciled
```

## Conclusion

The Drain Cleaner is a lightweight application that runs as a singleton service on your Kubernetes cluster. With a small 
overhead you can guarantee high availability for all your Kafka clusters. This is especially important when you have service 
level agreements (SLA) in place that you want to fulfill. This is a new component that recently joined the Strimzi family 
and it is supported since 0.21.0 release, but not yet released. For that reason, there are plenty of opportunities for 
contributing code, documentation and feedback. Happy hacking :-)
