---
layout: default
---

# Starting OKD 

This assumes that you have the latest version of the `oc` binary, which you can get [here](https://github.com/openshift/origin/releases).

```shell
oc cluster up
```

This will start a local installation of [OKD](https://www.okd.io/), the Origin Community Distribution of Kubernetes that powers Red Hat OpenShift. Once this is completed, login as a `cluster-admin` user:

```shell
# Install as cluster-admin
oc login -u system:admin
```

# Applying Strimzi installation file

Next we apply the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`). The CRDs define the schemas used for declarative management of the Kafka cluster, Kafka topics and users.

```shell
oc apply -f https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.11.0/strimzi-cluster-operator-0.11.0.yaml -n myproject
```

# Provision the Apache Kafka cluster

After that we feed Strimzi with a simple **Custom Resource**, which will than give you a simple, ephemeral Apache Kafka Cluster:

```shell
# Apply the `Kafka` Cluster CR file
oc apply -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/0.11.0/examples/kafka/kafka-persistent.yaml -n myproject
```

We can now watch the deployment on the `myproject` namesapce, and see all required pods being created:

```shell
oc get pods -n myproject -w
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

Enjoy your Apache Kafka cluster, running on OKD!
