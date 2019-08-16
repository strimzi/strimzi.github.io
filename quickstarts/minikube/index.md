---
title: Minikube Quickstart
layout: default
---

# Starting Minikube

This assumes that you have the latest version of the `minikube` binary, which you can get [here](https://kubernetes.io/docs/setup/minikube/#installation).

```shell
minikube start
```

> NOTE: Make sure to start `minikube` with your configured VM. If need help look at the [documentation](https://kubernetes.io/docs/setup/minikube/#quickstart) for more.

Once Minikube is started, let's create our `kafka` namespace:

```shell
kubectl create namespace kafka
```

# Applying Strimzi installation file

Next we apply the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`). The CRDs define the schemas used for declarative management of the Kafka cluster, Kafka topics and users.

```shell
curl -L https://github.com/strimzi/strimzi-kafka-operator/releases/download/{{site.data.releases.operator[0].version}}/strimzi-cluster-operator-{{site.data.releases.operator[0].version}}.yaml \
  | sed 's/namespace: .*/namespace: kafka/' \
  | kubectl -n kafka apply -f -
```

# Provision the Apache Kafka cluster

After that we feed Strimzi with a simple **Custom Resource**, which will than give you a small persistent Apache Kafka Cluster with one node for each, Apache Zookeeper and Apache Kafka:

```shell
# Apply the `Kafka` Cluster CR file
kubectl -n kafka apply -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/{{site.data.releases.operator[0].version}}/examples/kafka/kafka-persistent-single.yaml 
```

We now need to wait while Kubernetes starts the required pods, services and so on:

```shell
kubectl -n kafka wait --for=condition=Ready kafka/my-cluster --timeout=300s
```

The above command might timeout if you're downloading images over a slow connection. If that happens you can always run it again.

# Send and receive messages

Once the cluster is running, you can run a simple producer to send messages to a Kafka topic (the topic will be automatically created):

```shell
kubectl -n kafka run kafka-producer -ti --image=strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-producer.sh --broker-list my-cluster-kafka-bootstrap:9092 --topic my-topic
```

And to receive them in a different terminal you can run:

```shell
kubectl -n kafka run kafka-consumer -ti --image=strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic --from-beginning
```

Enjoy your Apache Kafka cluster, running on Minikube!
