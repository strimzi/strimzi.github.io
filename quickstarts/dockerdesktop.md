Docker Desktop includes a standalone Kubernetes server and client, designed for local testing of Kubernetes.
You can start a Kubernetes cluster as a single-node cluster within a Docker container on your local system.

# Installing the dependencies

This quickstart assumes that you have installed the latest version of Docker Desktop, which you can download from the [Docker website](https://docs.docker.com/desktop/).

If you are running on Linux, you'll need to install the `kubectl` binary separately.
You can get the binary by following the [`kubectl` installation instructions](https://kubernetes.io/docs/tasks/tools/) from the Kubernetes website.

After you have installed the binary, make sure it works:

```shell
# Validate kubectl if on Linux
kubectl version
```

# Starting the Kubernetes cluster

Follow these steps to start a local development cluster of Kubernetes with [Docker Desktop](https://docs.docker.com/desktop/kubernetes/) which runs in a container on your local machine.

1. From the **Docker Dashboard**, select the **Setting** icon, or **Preferences** icon if you use a macOS.
1. Select **Kubernetes** from the left sidebar.
1. Next to **Enable Kubernetes**, select the checkbox.
1. Select **Apply & Restart** to save the settings, and then click **Install** to confirm.
   This instantiates the images required to run the Kubernetes server as containers, and installs the `/usr/local/bin/kubectl` command on your machine.


# Deploy Strimzi using installation files

Before deploying the Strimzi cluster operator, create a namespace called `kafka`:

```shell
kubectl create namespace kafka
```

Apply the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`). The CRDs define the schemas used for the custom resources (CRs, such as `Kafka`, `KafkaTopic` and so on) you will be using to manage Kafka clusters, topics and users.

```shell
kubectl create -f 'https://strimzi.io/install/latest?namespace=kafka' -n kafka
```

The YAML files for `ClusterRoles` and `ClusterRoleBindings` downloaded from strimzi.io contain a default namespace of `myproject`.
The query parameter `namespace=kafka` updates these files to use `kafka` instead.
By specifying `-n kafka` when running `kubectl create`, the definitions and configurations without a namespace reference are also installed in the `kafka` namespace.
If there is a mismatch between namespaces, then the Strimzi cluster operator will not have the necessary permissions to perform its operations.

Follow the deployment of the Strimzi cluster operator:
```shell
kubectl get pod -n kafka --watch
```

You can also follow the operator's log:
```shell
kubectl logs deployment/strimzi-cluster-operator -n kafka -f
```

Once the operator is running it will watch for new custom resources and create the Kafka cluster, topics or users that correspond to those custom resources.

# Create an Apache Kafka cluster

Create a new Kafka custom resource to get a small persistent Apache Kafka Cluster with one node for Apache Zookeeper and Apache Kafka:

```shell
# Apply the `Kafka` Cluster CR file
kubectl apply -f https://strimzi.io/examples/latest/kafka/kafka-persistent-single.yaml -n kafka 
```

Wait while Kubernetes starts the required pods, services, and so on:

```shell
kubectl wait kafka/my-cluster --for=condition=Ready --timeout=300s -n kafka 
```

The above command might timeout if you're downloading images over a slow connection. If that happens you can always run it again.

# Send and receive messages

With the cluster running, run a simple producer to send messages to a Kafka topic (the topic is automatically created):

```shell
kubectl -n kafka run kafka-producer -ti --image=quay.io/strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-producer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic
```

And to receive them in a different terminal, run:

```shell
kubectl -n kafka run kafka-consumer -ti --image=quay.io/strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic --from-beginning
```

Enjoy your Apache Kafka cluster, running on Docker Desktop Kubernetes!

# Deleting your Apache Kafka cluster

When you are finished with your Apache Kafka cluster, you can delete it by running:

```shell
kubectl -n kafka delete $(kubectl get strimzi -o name -n kafka)
```

This will remove all Strimzi custom resources, including the Apache Kafka cluster and any KafkaTopic custom resources but leave the Strimzi cluster operator running so that it can respond to new Kafka custom resources.

# Deleting the Strimzi cluster operator

When you want to fully remove the Strimzi cluster operator and associated definitions, you can run:

```shell
kubectl -n kafka delete -f 'https://strimzi.io/install/latest?namespace=kafka'
```

# Where next?

* If that was a little too quick, you might prefer a more [descriptive introduction to Strimzi](/docs/operators/latest/quickstart.html), covering the same ground but with more explanation.
* For an overview of the Strimzi components check out the [overview guide](/docs/operators/latest/overview.html).
* For alternative examples of the custom resource that defines the Kafka cluster have a look at these [examples]({{site.github_url}}/strimzi-kafka-operator/tree/{{site.data.releases.operator[0].version}}/examples/kafka)