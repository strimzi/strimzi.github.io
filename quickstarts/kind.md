Kubernetes Kind is a Kubernetes cluster implemented as a single Docker image that runs as a container.
It was primarily designed for testing Kubernetes itself, but may be used for local development or CI.

When using a local install of Minikube or Minishift, the Kubernetes cluster is started inside a virtual machine, running a Linux kernel and a Docker daemon, consuming extra CPU and RAM.

Kind, on the other hand, requires no additional VM - it simply runs as a linux container with a set of processes using the same Linux kernel used by your Docker daemon.
For this reason it is faster to start, and consumes less CPU and RAM than the alternatives, which is especially noticeable when running a Docker daemon natively on a Linux host.

_Note: Kubernetes Kind does currently not support node ports or load balancers. You will not be able to easily access your Kafka cluster from outside of the Kubernetes environment. If you need access from outside, we recommend to use Minikube instead._

### Installing the dependencies

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

### Configuring the Docker daemon

If your Docker Daemon runs as a VM you'll most likely need to configure how much memory the VM should have, how many CPUs, how much disk space, and swap size.
Make sure to assign at least 2 CPUs, and preferably 4 Gb or more of RAM. Consult the Docker documentation for you platform how to configure these settings.

### Starting the Kubernetes cluster

Start a local development cluster of [Kubernetes Kind](https://github.com/kubernetes-sigs/kind) that installs as a single docker container.

```shell
kind create cluster
```

{% include quickstarts/create-commands.md %}

Enjoy your Apache Kafka cluster, running on Kind!

{% include quickstarts/delete-commands.md %}

{% include quickstarts/next-steps.md %}