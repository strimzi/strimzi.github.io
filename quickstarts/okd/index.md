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
oc apply -f https://github.com/strimzi/strimzi-kafka-operator/releases/download/{{site.data.releases.operator[0].version}}/strimzi-cluster-operator-{{site.data.releases.operator[0].version}}.yaml -n myproject
```

# Provision the Apache Kafka cluster

After that we feed Strimzi with a simple **Custom Resource**, which will than give you a small persistent Apache Kafka Cluster with one node for each, Apache Zookeeper and Apache Kafka:

```shell
# Apply the `Kafka` Cluster CR file
oc apply -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/{{site.data.releases.operator[0].version}}/examples/kafka/kafka-persistent-single.yaml -n myproject
```

We can now watch the deployment on the `myproject` namesapce, and see all required pods being created:

```shell
oc get pods -n myproject -w
```

The installation is complete, once the `my-cluster-entity-operator` is running, like:

```
my-cluster-entity-operator-6bc7f6985c-q29p5   3/3     Running   0          44s
my-cluster-kafka-0                            2/2     Running   1          91s
my-cluster-zookeeper-0                        2/2     Running   0          2m30s
strimzi-cluster-operator-78f8bf857-kpmhb      1/1     Running   0          3m10s
```

# Send and receive messages

Once the cluster is running, you can run a simple producer to send messages to Kafka topic (the topic will be automatically created):

```shell
oc run kafka-producer -ti --image=strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-producer.sh --broker-list my-cluster-kafka-bootstrap:9092 --topic my-topic
```

And to receive them:

```shell
oc run kafka-consumer -ti --image=strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic --from-beginning
```

Enjoy your Apache Kafka cluster, running on OKD!
