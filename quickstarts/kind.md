Kubernetes Kind is a Kubernetes cluster implemented as a single Docker image that runs as a container.
It was primarily designed for testing Kubernetes itself, but may be used for local development or CI.

When using a local install of Minikube or Minishift, the Kubernetes cluster is started inside a virtual machine, running a Linux kernel and a Docker daemon, consuming extra CPU and RAM.

Kind, on the other hand, requires no additional VM - it simply runs as a linux container with a set of processes using the same Linux kernel used by your Docker daemon.
For this reason it is faster to start, and consumes less CPU and RAM than the alternatives, which is especially noticeable when running a Docker daemon natively on a Linux host.

_Note: Kubernetes Kind does currently not support node ports or load balancers. You will not be able to easily access your Kafka cluster from outside of the Kubernetes environment. If you need access from outside, we recommend to use Minikube instead._

# Installing the dependencies

This quickstart assumes that you have the latest version of the `kind` binary, which you can get from the [Kind GitHub repository](https://github.com/kubernetes-sigs/kind/releases).

Kind requires a running Docker Daemon. There are different Docker options depending on your host platform.
You can follow the instructions on the [Docker website](https://docs.docker.com/get-docker/).

You'll also need the `kubectl` binary, which you can get by following the [`kubectl` installation instructions](https://kubernetes.io/docs/tasks/tools/install-kubectl/).

Once you have all the binaries installed, and a Docker daemon running, make sure everything works:

```shell
# Validate docker installation
docker ps
docker version

# Validate kind
kind version

# Validate kubectl
kubectl version
```

# Configuring the Docker daemon

If your Docker Daemon runs as a VM you'll most likely need to configure how much memory the VM should have, how many CPUs, how much disk space, and swap size.
Make sure to assign at least 2 CPUs, and preferably 4 Gb or more of RAM. Consult the Docker documentation for you platform how to configure these settings.

# Starting the Kubernetes cluster

Start a local development cluster of [Kubernetes Kind](https://github.com/kubernetes-sigs/kind) that installs as a single docker container.

```shell
kind create cluster
```

# Deploy Strimzi using installation files

Before deploying the Strimzi cluster operator, create a namespace called `kafka`:

```shell
kubectl create namespace kafka
```

Apply the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`). The CRDs define the schemas used for declarative management of the Kafka cluster, Kafka topics and users.

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

# Configure an Apache Kafka cluster

Configure a new Kafka custom resource to create a small persistent Apache Kafka Cluster with one node for Apache Zookeeper and Apache Kafka:

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

Enjoy your Apache Kafka cluster, running on Kind!

# Deleting your Apache Kafka cluster

When you are finished with your Apache Kafka cluster, you can delete it by running:

```shell
kubectl -n kafka delete kafka my-cluster
```

This will remove the Apache Kafka cluster but leave the Strimzi cluster operator running so that it can respond to new Kafka custom resources.

# Where next?

* If that was a little too quick, you might prefer a more [descriptive introduction to Strimzi](/docs/operators/latest/quickstart.html), covering the same ground but with more explanation.
* For an overview of the Strimzi components check out the [overview guide](/docs/operators/latest/overview.html).
* For alternative examples of the custom resource that defines the Kafka cluster have a look at these [examples]({{site.github_url}}/strimzi-kafka-operator/tree/{{site.data.releases.operator[0].version}}/examples/kafka)