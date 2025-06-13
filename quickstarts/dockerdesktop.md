Docker Desktop includes a standalone Kubernetes server and client, designed for local testing of Kubernetes.
You can start a Kubernetes cluster as a single-node cluster within a Docker container on your local system.

### Installing the dependencies

This quickstart assumes that you have installed the latest version of Docker Desktop, which you can download from the [Docker website](https://docs.docker.com/desktop/).

If you are running on Linux, you'll need to install the `kubectl` binary separately.
You can get the binary by following the [`kubectl` installation instructions](https://kubernetes.io/docs/tasks/tools/) from the Kubernetes website.

After you have installed the binary, make sure it works:

```shell
# Validate kubectl if on Linux
kubectl version
```

### Starting the Kubernetes cluster

Follow these steps to start a local development cluster of Kubernetes with [Docker Desktop](https://docs.docker.com/desktop/kubernetes/) which runs in a container on your local machine.

1. From the **Docker Dashboard**, select the **Setting** icon, or **Preferences** icon if you use a macOS.
1. Select **Kubernetes** from the left sidebar.
1. Next to **Enable Kubernetes**, select the checkbox.
1. Select **Apply & Restart** to save the settings, and then click **Install** to confirm.
   This instantiates the images required to run the Kubernetes server as containers, and installs the `/usr/local/bin/kubectl` command on your machine.

{% include quickstarts/create-commands.md %}

Enjoy your Apache Kafka cluster, running on Docker Desktop Kubernetes!

{% include quickstarts/delete-commands.md %}

{% include quickstarts/next-steps.md %}