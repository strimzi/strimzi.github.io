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
oc apply -f 'https://strimzi.io/install/latest?namespace=myproject' -n myproject
```

# Provision the Apache Kafka cluster

After that we feed Strimzi with a simple **Custom Resource**, which will then give you a small persistent Apache Kafka Cluster with one node for each, Apache Zookeeper and Apache Kafka:

```shell
# Apply the `Kafka` Cluster CR file
oc apply -f https://strimzi.io/examples/latest/kafka/kafka-persistent-single.yaml -n myproject 
```

We now need to wait while OpenShift starts the required pods, services and so on:

```shell
oc wait kafka/my-cluster --for=condition=Ready --timeout=300s -n myproject
```

The above command might timeout if you're downloading images over a slow connection. If that happens you can always run it again.

# Send and receive messages

Once the cluster is running, you can run a simple producer to send messages to Kafka topic (the topic will be automatically created):

```shell
oc -n myproject run kafka-producer -ti --image=strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-producer.sh --broker-list my-cluster-kafka-bootstrap:9092 --topic my-topic
```

And to receive them in a different terminal you can run:

```shell
oc -n myproject run kafka-consumer -ti --image=strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic --from-beginning
```

Enjoy your Apache Kafka cluster, running on OKD!
