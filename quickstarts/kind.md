Kubernetes Kind is a Kubernetes cluster implemented as a single Docker image that runs as a container.
It was primarily designed for testing Kubernetes itself, but may be used for local development or CI.

When using a local install of Minikube or Minishift, the Kubernetes cluster is started inside a virtual machine, running a Linux kernel and a Docker daemon, consuming extra CPU and RAM.

Kind, on the other hand, requires no additional VM - it simply runs as a linux container with a set of processes using the same Linux kernel used by your Docker daemon.
For this reason it is faster to start, and consumes less CPU and RAM than the alternatives, which is especially noticeable when running a Docker daemon natively on a Linux host.

_Note: Kubernetes Kind does currently not support node ports or load balancers. You will not be able to easily access your Kafka cluster from outside of the Kubernetes environment. If you need access from outside, we recommend to use Minikube instead._

# Installing the dependencies

This quickstart assumes that you have the latest version of the `kind` binary, which you can get [here](https://github.com/kubernetes-sigs/kind/releases).

Kind requires a running Docker Daemon. There are different Docker options depending on your host platform.
You can follow the instructions [here](https://docs.docker.com/get-docker/).

You'll also need the `kubectl` binary, which you can get by following the instructions [here](https://kubernetes.io/docs/tasks/tools/install-kubectl/).

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

# Starting Kubernetes cluster

This will start a local development cluster of [Kubernetes Kind](https://github.com/kubernetes-sigs/kind) which installs as a single docker container.

```shell
kind create cluster
```

# Applying Strimzi installation file

Before deploying Strimzi Kafka operator, let's first create our `kafka` namespace:

```shell
kubectl create namespace kafka
```

Next we apply the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`). The CRDs define the schemas used for declarative management of the Kafka cluster, Kafka topics and users.

```shell
kubectl create -f 'https://strimzi.io/install/latest?namespace=kafka' -n kafka
```

This will be familiar if you've installed Strimzi on things like minikube before.
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

Enjoy your Apache Kafka cluster, running on Kind!

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