---
layout: post
title:  "Running Strimzi on Azure Container Service"
date: 2018-08-XX
author: paolo_patierno
---

One of the most simpler ways for deploying a Kubernetes cluster without the complexity of setting up the nodes manually (even if using virtual machines and not "real" hardware) and then installing all the needed Kubernetes components, is to use a fully managed Kubernetes container orchestration service.
All the main cloud providers has this kind of offer in their portfolio and one of them is the [AKS (Azure Container Service)](https://azure.microsoft.com/en-us/services/kubernetes-service/) from Microsoft.
Using the Azure portal through a web browser or the Azure CLI (Command Line Interface), it's just a matter of few clicks and/or commands and few minutes for having a fully functional Kubernetes cluster in order to install our containarized applications on top of it.
This is really a great way for having Strimzi up and running in the cloud and then deploying an Apache Kafka cluster through it.

<!--more-->

There are several ways for deploying a Kubernetes cluster using AKS and throughout this post I'll show how to use the Azure CLI locally for doing that.

First of all, you need to install the Azure CLI 2.0 on your laptop. At the time of writing, the latest version is the 2.0.44 and you can find all the instructions for downloading and installing it on the official documentation [page](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli).

At the end of the procedure you'll have the `az` tool available on your path for interacting with the Azure cloud from the command line.

# Create a resource group

On Azure, there is the concept of "resource group" which is a logical group in which Azure resources are deployed and managed.
A complex deployment could need different resources as storage, virtual machines, vpn and so on and having them all together is a resource group is really useful for handling them as a whole (i.e. for deleting the entire deployment with a single command).

The first step is to create a resource group in a specific Azure location.

```
az group create --name strimzigroup --location northeurope
```

The above command will provide you a JSON as output with the final status of the resource group creation.

TBD : JSON output

> if you don't know what's the exact name to use for the `--location` option, you can get the full list of available location using the command `az account list-locations`

# Create a AKS cluster

The `az` tool provides a `aks` subcommand for interacting with the AKS in order to create and manage a Kubernetes cluster.
In order to create a new Kubernetes cluster, the `create` command has different options but the main ones are the destination resource group, the name of the cluster and the related number of nodes.

```
az aks create --resource-group strimzigroup --name strimzicluster --node-count 3 --generate-ssh-keys
```

After several minutes, the command completes and returns the information about the cluster in the JSON format.

TBD : JSON output

# Connect to the cluster

Because you are going to interact with a Kubernetes cluster, you need the `kubectl` tool for doing that.
In order to install it, you can follow the official Kubernetes documentation [here](https://kubernetes.io/docs/tasks/tools/install-kubectl/) or using the handy `az aks install-cli` that will do it for you.

After downloading and installing the `kubectl` tool, you need to configure it with the right credentials for connecting to the just deployed Kubernetes cluster in AKS and the following command will do it.

```
az aks get-credentials --resource-group strimzigroup --name strimzicluster
```

To verify that the connection with the Kubernetes cluster is working you can just run the `kubectl get nodes` command for showing all the available nodes in the cluster.

TBD : Kubernetes cluster nodes output

# Deploying Strimzi and an Apache Kafka

Now that we have a Kubernetes cluster up and running in the cloud, we can deploy Strimzi in order to deploy an Apache Kafka cluster through the Cluster Operator.
First of all you have to get the latest Strimzi release from [here](https://github.com/strimzi/strimzi-kafka-operator/releases).
The first step is to modify the installation files accordingly to the namespace the Cluster Operator is going to be installed.

```
sed -i 's/namespace: .*/namespace: <my-namespace>/' examples/install/cluster-operator/*ClusterRoleBinding*.yaml
```

> If you want to deploy the Cluster Operator in the Kubernetes `default` namespace you have just to use `default` for the `<my-namespace>` placeholder in the above command.

Deploying the Cluster Operator is just a matter of running:

```
kubectl create -f examples/install/cluster-operator
```

You can check that the related Pod is up and running just executing:

```
kubectl get pods
```

TBD: Cluster Operator pod running output

The Strimzi release provides an `examples` folder with examples YAML files for deploying an Kafka cluster with "ephemeral" and "persistent" storage and for deploying Kafka Connect as well.
You can modify the related YAML files in order to customize for your needs but for the sake of this blog post, it's enough using the already provided Kafka cluster "ephemeral" example by running:

```
kubectl apply -f examples/kafka/kafka-ephemeral.yaml
```

For checking that the deployment is going on, you can run:

```
kubectl get pods -w
```

After few minutes, the Apache Kafka cluster will be running in the cloud!
