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

```json
{
  "id": "/subscriptions/<your-subscription-id>/resourceGroups/strimzigroup",
  "location": "northeurope",
  "managedBy": null,
  "name": "strimzigroup",
  "properties": {
    "provisioningState": "Succeeded"
  },
  "tags": null
}
```

> if you don't know what's the exact name to use for the `--location` option, you can get the full list of available location using the command `az account list-locations`

# Create a AKS cluster

The `az` tool provides a `aks` subcommand for interacting with the AKS in order to create and manage a Kubernetes cluster.
In order to create a new Kubernetes cluster, the `create` command has different options but the main ones are the destination resource group, the name of the cluster and the related number of nodes.

```
az aks create --resource-group strimzigroup --name strimzicluster --node-count 3 --generate-ssh-keys
```

After several minutes, the command completes and returns the information about the cluster in the JSON format.

```json
{
  "aadProfile": null,
  "addonProfiles": null,
  "agentPoolProfiles": [
    {
      "count": 3,
      "maxPods": 110,
      "name": "nodepool1",
      "osDiskSizeGb": null,
      "osType": "Linux",
      "storageProfile": "ManagedDisks",
      "vmSize": "Standard_DS1_v2",
      "vnetSubnetId": null
    }
  ],
  "dnsPrefix": "strimziclu-strimzigroup-1de242",
  "enableRbac": true,
  "fqdn": "strimziclu-strimzigroup-1de242-bf1a6c8a.hcp.northeurope.azmk8s.io",
  "id": "/subscriptions/<your-subscription-id>/resourcegroups/strimzigroup/providers/Microsoft.ContainerService/managedClusters/strimzicluster",
  "kubernetesVersion": "1.9.9",
  "linuxProfile": {
    "adminUsername": "azureuser",
    "ssh": {
      "publicKeys": [
        {
          "keyData": "ssh-rsa <key-data>"
        }
      ]
    }
  },
  "location": "northeurope",
  "name": "strimzicluster",
  "networkProfile": {
    "dnsServiceIp": "10.0.0.10",
    "dockerBridgeCidr": "172.17.0.1/16",
    "networkPlugin": "kubenet",
    "networkPolicy": null,
    "podCidr": "10.244.0.0/16",
    "serviceCidr": "10.0.0.0/16"
  },
  "nodeResourceGroup": "MC_strimzigroup_strimzicluster_northeurope",
  "provisioningState": "Succeeded",
  "resourceGroup": "strimzigroup",
  "servicePrincipalProfile": {
    "clientId": "f96f2c4a-02b2-49ac-bcb1-f94c9679abc5",
    "secret": null
  },
  "tags": null,
  "type": "Microsoft.ContainerService/ManagedClusters"
}

```

> if you want a cluster running a specific Kubernetes version, you can use the `--kubernetes-version` option. All the supported options for the creation command are available at the official [documentation](https://docs.microsoft.com/en-us/cli/azure/aks?view=azure-cli-latest#az-aks-create).

# Connect to the cluster

Because you are going to interact with a Kubernetes cluster, you need the `kubectl` tool for doing that.
In order to install it, you can follow the official Kubernetes documentation [here](https://kubernetes.io/docs/tasks/tools/install-kubectl/) or using the handy `az aks install-cli` that will do it for you.

After downloading and installing the `kubectl` tool, you need to configure it with the right credentials for connecting to the just deployed Kubernetes cluster in AKS and the following command will do it.

```
az aks get-credentials --resource-group strimzigroup --name strimzicluster
```

To verify that the connection with the Kubernetes cluster is working you can just run the `kubectl get nodes` command for showing all the available nodes in the cluster.

```
NAME                       STATUS    ROLES     AGE       VERSION
aks-nodepool1-24085136-0   Ready     agent     7m        v1.9.9
aks-nodepool1-24085136-1   Ready     agent     7m        v1.9.9
aks-nodepool1-24085136-2   Ready     agent     7m        v1.9.9
```

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
NAME                                        READY     STATUS    RESTARTS   AGE
strimzi-cluster-operator-65659b5f86-t5jsp   1/1       Running   0          1m
```

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

It's also possible to show the Kubernetes dashboard with all the Pods by running:

```
az aks browse --name strimzicluster --resource-group strimzigroup
```

![Kubernetes dashboard with Strimzi and Apache Kafka running]({{ "/assets/2018-08-XX-kubernetes-dashboard.png" | absolute_url }})