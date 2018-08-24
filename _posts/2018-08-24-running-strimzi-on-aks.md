---
layout: post
title:  "Apache Kafka in the Cloud in 15 minutes using Strimzi and Azure Container Service"
date: 2018-08-24
author: paolo_patierno
---

One of the simplest ways to deploy a Kubernetes cluster is to use a fully-managed Kubernetes container orchestration service.
This avoids the complexity of setting up the nodes manually (even if using virtual machines and not "real" hardware) and then installing all the needed Kubernetes components.
All the main cloud providers have a Kubernetes offer in their portfolio and one of them is the [AKS (Azure Container Service)](https://azure.microsoft.com/en-us/services/kubernetes-service/) from Microsoft.
Using the Azure portal through a web browser or the Azure CLI (Command Line Interface), it's just a matter of a few clicks and/or commands and a few minutes to have a fully functional Kubernetes cluster where we can install our containarized applications.
This is a really great way to have Strimzi up and running in the cloud and then deploying an Apache Kafka cluster through it.

So in this post I'm going to show you how easy it is to deploy Strimzi on AKS using the CLI.
If you already have an Azure account you can be up and running with Strimzi in 15 minutes.
If not you can sign up [here](https://azure.microsoft.com).

<!--more-->

First of all, you need to install the Azure CLI 2.0 on your laptop. You can find all the instructions for downloading and installing it on the official documentation [page](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli).

At the end of the procedure you'll have the `az` tool available on your path for interacting with the Azure cloud from the command line.

# Create a resource group

On Azure, a "resource group" is a logical group in which Azure resources are deployed and managed.
A complex deployment could need different resources such as storage, virtual machines, VPN and so on. 
Having them all together in a resource group is really useful for handling them as a whole (for example, deleting the entire deployment with a single command when you're done).

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

> If you don't know the exact name to use for the `--location` option, you can get the full list of available location using the command `az account list-locations`.

# Create a AKS cluster

The `az` tool provides a `aks` command for interacting with the AKS in order to create and manage a Kubernetes cluster.
To create a new Kubernetes cluster, the `create` subcommand has different options but the main ones are the destination resource group, the name of the cluster and the related number of nodes.

```
az aks create --resource-group strimzigroup --name strimzicluster --node-count 3 --generate-ssh-keys
```

After a few minutes, the command completes and returns the information about the cluster in JSON format.

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

To check that the Kubernetes cluster was deployed successfully, the `provisioningState` has to have the "Succeeded" value.
It's also interesting to notice the `agentPoolProfiles` field which provides information about the type of VMs used to deploy the Kubernetes cluster (it can be changed using different command line options like `--node-osdisk-size` and `--node-vm-size`).

> If you want a cluster running a specific Kubernetes version, you can use the `--kubernetes-version` option. All the supported options for the creation command are available at the official [documentation](https://docs.microsoft.com/en-us/cli/azure/aks?view=azure-cli-latest#az-aks-create).

# Connect to the cluster

In this blog post I'm going to use the `kubectl` tool to interact with the Kubernetes cluster.
In order to install it, you can follow the official Kubernetes documentation [here](https://kubernetes.io/docs/tasks/tools/install-kubectl/) or using the handy `az aks install-cli` that will do it for you.

After downloading and installing the `kubectl` tool, you need to configure it with the right credentials to connect to the Kubernetes cluster you just deployed in AKS:

```
az aks get-credentials --resource-group strimzigroup --name strimzicluster
```

You can verify that the connection with the Kubernetes cluster is working by running the `kubectl get nodes` command to show all the available nodes in the cluster:

```
NAME                       STATUS    ROLES     AGE       VERSION
aks-nodepool1-24085136-0   Ready     agent     7m        v1.9.9
aks-nodepool1-24085136-1   Ready     agent     7m        v1.9.9
aks-nodepool1-24085136-2   Ready     agent     7m        v1.9.9
```

# Deploying Strimzi and an Apache Kafka cluster

Now that you have a Kubernetes cluster up and running in the cloud, you can deploy Strimzi in order to deploy an Apache Kafka cluster using the Cluster Operator.
First of all you have to download the latest Strimzi release from [here](https://github.com/strimzi/strimzi-kafka-operator/releases).
The first step is to modify the installation files according to the namespace the Cluster Operator is going to be installed in.

```
sed -i 's/namespace: .*/namespace: <my-namespace>/' examples/install/cluster-operator/*ClusterRoleBinding*.yaml
```

> If you want to deploy the Cluster Operator in the Kubernetes `default` namespace you have just to use `default` for the `<my-namespace>` placeholder in the above command.

I'm going to use the `default` namespace, so the `sed` command will be:

```
sed -i 's/namespace: .*/namespace: default/' examples/install/cluster-operator/*ClusterRoleBinding*.yaml
```

Deploying the Cluster Operator is just a matter of running:

```
kubectl create -f examples/install/cluster-operator
```

You can check that the related Pod is up and running by executing:

```
kubectl get pods
NAME                                        READY     STATUS    RESTARTS   AGE
strimzi-cluster-operator-65659b5f86-t5jsp   1/1       Running   0          1m
```

The Strimzi release provides an `examples` folder with examples YAML files for deploying a Kafka cluster with "ephemeral" and "persistent" [storage](http://strimzi.io/docs/master/#assembly-storage-deployment-configuration-kafka) and for deploying Kafka Connect as well.
You can modify the related YAML files in order to customize them for your needs but for the sake of this blog post, I'm just going to use the provided Kafka cluster "ephemeral" example by running:

```
kubectl apply -f examples/kafka/kafka-ephemeral.yaml
```

To check that the deployment is going on, you can run:

```
kubectl get pods -w
```

After a few minutes, your Apache Kafka cluster will be running in the cloud!

It's also possible to show the Kubernetes dashboard with all the Pods by running:

```
az aks browse --name strimzicluster --resource-group strimzigroup
```

It will open your default browser showing the dashboard, like this:

![Kubernetes dashboard with Strimzi and Apache Kafka running]({{ "/assets/2018-08-24-kubernetes-dashboard.png" | absolute_url }})

# Conclusion

Setting up a Kubernetes cluster isn't a simple task.
Using a fully-managed Kubernetes container orchestration service like Azure Container Service (AKS) can help you to quickly provision such a cluster.
At same time, setting up an Apache Kafka cluster in the cloud can be complex and the Strimzi project helps you to do that in a really simple way.
As you saw throughout this blog post, combining AKS and Strimzi provides a great way to get an Apache Kafka cluster up and running on a Kubernetes cluster in the cloud in more or less 15 minutes. 
