# Starting OKD 

This assumes that you have the latest version of the `oc` binary, which you can get [here](https://github.com/OKD/origin/releases).

```shell
oc cluster up
```

This will start a local installation of OKD. Once this is completed, login as a `cluster-admin` user:

```shell
# Install as cluster-admin
oc login -u system:admin
```

# Applying Strimzi installation file

Next we are applying the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`) for the Apache Kafka itself, or creating Apache Kafka topics:

```shell
oc apply -f https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.8.1/strimzi-cluster-operator-0.8.1.yaml -n myproject
```

# Provision the Apache Kafka cluster

Afterwards we feed Strimzi with a simple **Custom Resource**, which will than give you a simple, ephemeral Apache Kafka Cluster:

```shell
# Apply the `Kafka` Cluster CR file
oc apply -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/0.8.1/examples/kafka/kafka-ephemeral.yaml -n myproject
```

We can now watch the deployment on the `myproject` namesapce, and see all required pods being created:

```shell
oc get pods -n myproject -w
```

Enjoy your Apache Kafka cluster, running on OKD!
