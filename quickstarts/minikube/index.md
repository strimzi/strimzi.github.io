---
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
curl -L https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.10.0/strimzi-cluster-operator-0.10.0.yaml \
  | sed 's/namespace: .*/namespace: kafka/' \
  | kubectl -n kafka apply -f -
```

# Provision the Apache Kafka cluster

After that we feed Strimzi with a simple **Custom Resource**, which will than give you a simple, ephemeral Apache Kafka Cluster:

```shell
# Apply the `Kafka` Cluster CR file
kubectl apply -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/0.10.0/examples/kafka/kafka-persistent.yaml -n kafka
```

We can now watch the deployment on the `kafka` namespace, and see all required pods being created:

```shell
kubectl get pods -n kafka -w
```

The installation is complete, once the `my-cluster-entity-operator` is running, like:

```
my-cluster-entity-operator-6bc7f6985c-q29p5   3/3     Running   0          44s
my-cluster-kafka-0                            2/2     Running   1          91s
my-cluster-kafka-1                            2/2     Running   1          91s
my-cluster-kafka-2                            2/2     Running   1          91s
my-cluster-zookeeper-0                        2/2     Running   0          2m30s
my-cluster-zookeeper-1                        2/2     Running   0          2m30s
my-cluster-zookeeper-2                        2/2     Running   0          2m30s
strimzi-cluster-operator-78f8bf857-kpmhb      1/1     Running   0          3m10s
```

Enjoy your Apache Kafka cluster, running on Minikube!
