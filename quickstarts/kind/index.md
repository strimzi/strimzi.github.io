---
title: Kubernes Kind Quickstart
layout: default
---

# Installing the dependencies

This quickstart assumes that you have the latest version of the `kind` binary, which you can get [here](https://github.com/kubernetes-sigs/kind/releases).

Kind requires a running Docker Daemon. There are different Docker options depending on your host platform.
You can follow the instructions [here](https://docs.docker.com/get-docker/).

You'll also need `kubectl` binary, which you can get by following the instruction [here](https://kubernetes.io/docs/tasks/tools/install-kubectl/).

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
Make sure to assign at least 2 CPUs, and preferably 4 Gb or more of RAM. Consult Docker documentation for you platform.


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
curl -L https://github.com/strimzi/strimzi-kafka-operator/releases/download/{{site.data.releases.operator[0].version}}/strimzi-cluster-operator-{{site.data.releases.operator[0].version}}.yaml \
  | sed 's/namespace: .*/namespace: kafka/' \
  | kubectl apply -f - -n kafka 
```

Note how we set all the `namespace` references in downloaded .yaml file to `kafka`. By default they are set to `myproject`.
But we want them all to be `kafka` because we decided to install the operator into `kafka` namespace, which we achieve by specifying `-n kafka` when running `kubectl apply` ensuring that all the definitions and the configurations are installed in `kafka` namespace rather than the `default` namespace.

If there is a mismatch between namespaces, then the Strimzi Cluster Operator will not have the necessary permissions to perform its operations. 

Follow the deployment of strimzi kafka operator:
```shell
kubectl get pod -n kafka --watch
```

You can also follow the operator's log:
```shell
kubectl logs `kubectl get pod -n kafka | grep strimzi-cluster-operator | awk '{print $1}'` -n kafka -f
```

# Provision the Apache Kafka cluster

After that we feed Strimzi with a simple **Custom Resource**, which will then give you a small persistent Apache Kafka Cluster with one node for each, Apache Zookeeper and Apache Kafka:

```shell
# Apply the `Kafka` Cluster CR file
kubectl apply -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/{{site.data.releases.operator[0].version}}/examples/kafka/kafka-persistent-single.yaml -n kafka 
```

We now need to wait while Kubernetes starts the required pods, services and so on:

```shell
kubectl wait kafka/my-cluster --for=condition=Ready --timeout=300s -n kafka 
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

Enjoy your Apache Kafka cluster, running on Kind!
