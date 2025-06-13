Minikube provides a local Kubernetes, designed to make it easy to learn and develop for Kubernetes.
The Kubernetes cluster is started either inside a virtual machine, a container or on bare-metal, depending on the minikube driver you choose.

### Installing the dependencies

This quickstart assumes that you have the latest version of the `minikube` binary, which you can get from the [minikube website](https://minikube.sigs.k8s.io/docs/start/).

Minikube requires a container or virtual machine manager.
The Minikube documentation includes a list of suggested options in the [getting started guide](https://minikube.sigs.k8s.io/docs/start/).

You'll also need the `kubectl` binary, which you can get by following the [`kubectl` installation instructions](https://kubernetes.io/docs/tasks/tools/) from the Kubernetes website.

Once you have all the binaries installed, make sure everything works:

```shell
# Validate minikube
minikube version

# Validate kubectl
kubectl version
```

### Starting the Kubernetes cluster

Start a local development cluster of [Minikube](https://minikube.sigs.k8s.io/docs/start/) that runs in a container or virtual machine manager.

```shell
minikube start --memory=4096 # 2GB default memory isn't always enough
```

{% include quickstarts/create-commands.md %}

Enjoy your Apache Kafka cluster, running on Minikube!

{% include quickstarts/delete-commands.md %}

{% include quickstarts/next-steps.md %}