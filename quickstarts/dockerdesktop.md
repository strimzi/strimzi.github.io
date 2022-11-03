Docker Desktop comes includes a standalone Kubernetes server and client, designed for local testing of Kubernetes.
The Kubernetes cluster is started as a single-node cluster within a Docker container on your local system.

# Installing the dependencies

This quickstart assumes that you have the latest version of Docker Desktop, which you can get [here](https://docs.docker.com/desktop/).

If you are running on Linux you'll need to install the `kubectl` binary separately, which you can get by following the instructions [here](https://kubernetes.io/docs/tasks/tools/).

Once you have all the binary installed, make sure everything works:

```shell
# Validate kubectl if on Linux
kubectl version
```

# Starting Kubernetes cluster

This will start a local development cluster of Kubernetes with [Docker Desktop](https://docs.docker.com/desktop/kubernetes/) which runs in a container on your local machine.

1. From the Docker Dashboard, select the Setting icon, or Preferences icon if you use a macOS.
1. Select Kubernetes from the left sidebar.
1. Next to Enable Kubernetes, select the checkbox.
1. Select Apply & Restart to save the settings and then click Install to confirm.
   This instantiates images required to run the Kubernetes server as containers, and installs the `/usr/local/bin/kubectl` command on your machine.


# Applying Strimzi installation file

Before deploying Strimzi Kafka operator, let's first create our `kafka` namespace:

```shell
kubectl create namespace kafka
```

Next we apply the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`). The CRDs define the schemas used for declarative management of the Kafka cluster, Kafka topics and users.

```shell
kubectl create -f 'https://strimzi.io/install/latest?namespace=kafka' -n kafka
```

This will be familiar if you've installed Strimzi before.
Note how we set all the `namespace` references in downloaded .yaml file to `kafka`. By default they are set to `myproject`.
But we want them all to be `kafka` because we decided to install the operator into the `kafka` namespace, which we achieve by specifying `-n kafka` when running `kubectl create` ensuring that all the definitions and the configurations are installed in `kafka` namespace rather than the `default` namespace.

If there is a mismatch between namespaces, then the Strimzi Cluster Operator will not have the necessary permissions to perform its operations.

Follow the deployment of the Strimzi Kafka operator:
```shell
kubectl get pod -n kafka --watch
```

You can also follow the operator's log:
```shell
kubectl logs deployment/strimzi-cluster-operator -n kafka -f
```

# Provision the Apache Kafka cluster

Then we create a new Kafka custom resource, which will give us a small persistent Apache Kafka Cluster with one node for each - Apache Zookeeper and Apache Kafka:

```shell
# Apply the `Kafka` Cluster CR file
kubectl apply -f https://strimzi.io/examples/latest/kafka/kafka-persistent-single.yaml -n kafka 
```

We now need to wait while Kubernetes starts the required pods, services and so on:

```shell
kubectl wait kafka/my-cluster --for=condition=Ready --timeout=300s -n kafka 
```

The above command might timeout if you're downloading images over a slow connection. If that happens you can always run it again.

# Send and receive messages

Once the cluster is running, you can run a simple producer to send messages to a Kafka topic (the topic will be automatically created):

```shell
kubectl -n kafka run kafka-producer -ti --image=quay.io/strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-producer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic
```

And to receive them in a different terminal you can run:

```shell
kubectl -n kafka run kafka-consumer -ti --image=quay.io/strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic --from-beginning
```

Enjoy your Apache Kafka cluster, running on Docker Desktop Kubernetes!

# Deleting your Apache Kafka cluster

When you are finished with your Apache Kafka cluster you can delete it by running:

```shell
kubectl -n kafka delete kafka my-cluster
```

This will remove the Apache Kafka cluster but leave the Strimzi Cluster Operator running so that it can respond to new Kafka CRs.

# Where next?

* If that was a little too quick, you might prefer a more [descriptive introduction to Strimzi](/docs/operators/latest/quickstart.html), covering the same ground but with more explanation.
* For an overview of the Strimzi components check out the [overview guide](/docs/operators/latest/overview.html).
* For alternative examples of the custom resource which defines the Kafka cluster have a look at these [examples]({{site.github_url}}/strimzi-kafka-operator/tree/{{site.data.releases.operator[0].version}}/examples/kafka)