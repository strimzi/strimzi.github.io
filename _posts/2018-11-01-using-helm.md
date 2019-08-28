---
layout: post
title:  "Using Helm to deploy the Strimzi Kafka Operator"
date: 2018-11-01
author: seglo
---

The Kubernetes [Helm](https://helm.sh/) project is the leading way to package, configure, and deploy Kubernetes resources.
Let's see how it's possible to use it in order to deploy an Apache Kafka cluster on Kubernetes through the Strimzi project.

<!--more-->

# A brief introduction to Helm

The Kubernetes [Helm](https://helm.sh/) project is the leading way to package, configure, and deploy Kubernetes resources.
It allows you to bundle together a set of Kubernetes resource files that can be used to deploy any type of service or application you desire into your cluster.
Helm bundles together Kubernetes resources into a Helm Chart.
Individual Charts can be versioned and installed into a Helm Chart Repository that you can run locally, or deploy to a website.
There is a [_central_ Helm Chart Repository](https://github.com/helm/charts) which contain Charts for many commonly used cluster services.

Helm Charts are similar to [OpenShift Templates](https://docs.openshift.com/container-platform/3.11/dev_guide/templates.html), which allow you to template sets of resources to deploy into OpenShift.
Helm is agnostic to the flavour of Kubernetes used, so it may be run on minikube, GKE, or an on-premise cluster.
Bundling applications and services into Helm Charts provides several benefits, including:

* Package resources into a single tarball artifact that can be installed directly, or added to a Chart Repository.
* Version and release support to track the evolution of your Chart and [optionally] the underlying service its responsible for deploying.
* Dependency management.  One Chart may depend on another.
* Life cycle management hooks that can be used to trigger commands at different stages of the deployment lifecycle.
* Template verification and validation.
* [_and much more.._](https://helm.sh/)

Helm is split into two components: the `helm` command line tool, and the Tiller server.  The `helm` tool can be used to create and bundle Helm Charts, as well as to install and update existing Helm Releases.  The Tiller server runs as a pod in the Kubernetes cluster that the `helm` CLI communicates with using gRPC.

> **NOTE:** The Tiller server requires at least the same RBAC privileges as the resources that are to be deployed by a Chart.  Some Charts require more priveleged access than others.  For example, to install a `ClusterRoleBinding` you require the `cluster-admin` role.  It's for this reason that the Tiller server is usually granted the `cluster-admin` role itself so that it may deploy any kind of resource into the cluster.  Tiller will no longer be required in Helm 3.0 and the installation of Charts will inherit the priveleges of the user running the `helm` installation command.

For instructions on how to install Helm in an OpenShift environment please consult this blog post, [Getting started with Helm on OpenShift](https://blog.openshift.com/getting-started-helm-openshift/).

# Installation of the Strimzi Cluster Operator with Helm

The Strimzi Helm Chart facilitates the install of the Strimzi Cluster Operator and defines the `CustomResourceDefinitions` to create Strimzi resources.
Therefore, it's a two step process to eventually run a Kafka cluster.

* Install the Strimzi Cluster Operator with Helm.
* Create a `Kafka` Kubernetes resource which the Cluster Operator will use to create a Kafka and ZooKeeper cluster.

You can install the Strimzi Helm Chart by referencing the artifact directly from the Strimzi GitHub Releases page, or by using the Strimzi Chart Repository.

To reference it directly you can download the appropriate release from the Strimzi [GitHub Releases](https://github.com/strimzi/strimzi-kafka-operator/releases/) page, or provide the full URL to the Chart to a [`helm install`](https://docs.helm.sh/helm/#helm-install) command.

To use the Strimzi Chart Repository you must first add the Repository to your local Helm configuration.
Strimzi releases are published directly to their own [Helm Chart Repository](https://strimzi.io/charts/index.yaml) (located at [https://strimzi.io/charts/](https://strimzi.io/charts/index.yaml)) every release cycle.
You may optionally also download a version of the Chart and host it within your own organization's Helm Chart Repository.

First add the Strimzi Chart Repository.

```bash
helm repo add strimzi https://strimzi.io/charts/
```

Strimzi uploads a new Chart as part of the release process.
To see a full list of Strimzi Charts available use the [`helm search`](https://docs.helm.sh/helm/#helm-search) command.

```bash
$ helm search strimzi/ --versions
NAME                            Chart VERSION   APP VERSION     DESCRIPTION
strimzi/strimzi-kafka-operator  0.8.2           0.8.2           Strimzi: Kafka as a Service
strimzi/strimzi-kafka-operator  0.8.1           0.8.1           Strimzi: Kafka as a Service
strimzi/strimzi-kafka-operator  0.8.0           0.8.0           Strimzi: Kafka as a Service
strimzi/strimzi-kafka-operator  0.7.0           0.7.0           Strimzi: Kafka as a Service
strimzi/strimzi-kafka-operator  0.6.0           0.6.0           Strimzi: Kafka as a Service
```

Then you can install a version of the Strimzi Cluster Operator.

```bash
helm install strimzi/strimzi-kafka-operator
```

An instance of a Helm install into a cluster is known as a Release.
Helm will generate a random name for your Release, or you can provide your own by using the `--name` option.
To choose a non-default namespace you can use the `--namespace` option.
This will be the namespace that the Strimzi Cluster Operator will watch for `Kafka` resources that are created.
Below is an example that uses these options together.
To choose a specific version use the `--version` option (the latest version is used if none is provided).

```bash
helm install strimzi/strimzi-kafka-operator \
--name my-strimzi-release \
--namespace strimzi \
--version 0.8.2
```

Once the Cluster Operator is installed you may now [install a Kafka cluster](https://strimzi.io/docs/master/#kafka-cluster-str) as you normally would.

## Installation without using Helm Tiller server

If you cannot run the Tiller server in your Kubernetes cluster you can still use Helm to generate all the resources locally with your desired configuration.
Usually this is done if Tiller is not running or otherwise secured in a way in which you do not have access to it and you want to create a resource bundle for someone else to deploy into the cluster.

To accomplish this you can use the [`helm template`](https://docs.helm.sh/helm/#helm-template) command to generate the resources locally.  The Helm documentation makes the following disclaimer when choosing this method of installation.

> Any values that would normally be looked up or retrieved in-cluster will be faked locally. Additionally, none of the server-side testing of Chart validity (e.g. whether an API is supported) is done.

To use the `helm template` command you must first must fetch the Chart locally using the [`helm fetch`](https://docs.helm.sh/helm/#helm-fetch) command.

```bash
$ helm fetch strimzi/strimzi-kafka-operator --version 0.8.2
```

Then you can template the resources into a directory of your choice.
If you omit the `--output-dir` option then it will pipe the resources to STDOUT.
In this example it will output the Charts to a directory named after the Chart, `./strimzi-kafka-operator`.

```bash
$ helm template ./strimzi-kafka-operator-helm-Chart-0.8.2.tgz \
--name my-strimzi-release \
--namespace strimzi \
--output-dir .
wrote ./strimzi-kafka-operator/templates/010-ServiceAccount-strimzi-cluster-operator.yaml
wrote ./strimzi-kafka-operator/templates/040-Crd-kafka.yaml
wrote ./strimzi-kafka-operator/templates/041-Crd-kafkaconnect.yaml
wrote ./strimzi-kafka-operator/templates/042-Crd-kafkaconnects2i.yaml
wrote ./strimzi-kafka-operator/templates/043-Crd-kafkatopic.yaml
wrote ./strimzi-kafka-operator/templates/044-Crd-kafkauser.yaml
wrote ./strimzi-kafka-operator/templates/045-Crd-kafkamirrormaker.yaml
wrote ./strimzi-kafka-operator/templates/020-ClusterRole-strimzi-cluster-operator-role.yaml
wrote ./strimzi-kafka-operator/templates/021-ClusterRole-strimzi-cluster-operator-role.yaml
wrote ./strimzi-kafka-operator/templates/030-ClusterRole-strimzi-kafka-broker.yaml
wrote ./strimzi-kafka-operator/templates/031-ClusterRole-strimzi-entity-operator.yaml
wrote ./strimzi-kafka-operator/templates/032-ClusterRole-strimzi-topic-operator.yaml
wrote ./strimzi-kafka-operator/templates/021-ClusterRoleBinding-strimzi-cluster-operator.yaml
wrote ./strimzi-kafka-operator/templates/030-ClusterRoleBinding-strimzi-cluster-operator-kafka-broker-delegation.yaml
wrote ./strimzi-kafka-operator/templates/020-RoleBinding-strimzi-cluster-operator.yaml
wrote ./strimzi-kafka-operator/templates/031-RoleBinding-strimzi-cluster-operator-entity-operator-delegation.yaml
wrote ./strimzi-kafka-operator/templates/032-RoleBinding-strimzi-cluster-operator-topic-operator-delegation.yaml
wrote ./strimzi-kafka-operator/templates/050-Deployment-strimzi-cluster-operator.yaml
```

Finally, apply the generated resources.

```bash
$ kubectl apply -f ./strimzi-kafka-operator/* --namespace strimzi
serviceaccount/strimzi-cluster-operator created
clusterrole.rbac.authorization.k8s.io/strimzi-cluster-operator-namespaced created
rolebinding.rbac.authorization.k8s.io/strimzi-cluster-operator created
clusterrole.rbac.authorization.k8s.io/strimzi-cluster-operator-global created
clusterrolebinding.rbac.authorization.k8s.io/strimzi-cluster-operator created
clusterrole.rbac.authorization.k8s.io/strimzi-kafka-broker created
clusterrolebinding.rbac.authorization.k8s.io/strimzi-cluster-operator-kafka-broker-delegation created
clusterrole.rbac.authorization.k8s.io/strimzi-entity-operator created
rolebinding.rbac.authorization.k8s.io/strimzi-cluster-operator-entity-operator-delegation created
clusterrole.rbac.authorization.k8s.io/strimzi-topic-operator created
rolebinding.rbac.authorization.k8s.io/strimzi-cluster-operator-topic-operator-delegation created
customresourcedefinition.apiextensions.k8s.io/kafkas.kafka.strimzi.io created
customresourcedefinition.apiextensions.k8s.io/kafkaconnects.kafka.strimzi.io created
customresourcedefinition.apiextensions.k8s.io/kafkaconnects2is.kafka.strimzi.io created
customresourcedefinition.apiextensions.k8s.io/kafkatopics.kafka.strimzi.io created
customresourcedefinition.apiextensions.k8s.io/kafkausers.kafka.strimzi.io created
customresourcedefinition.apiextensions.k8s.io/kafkamirrormakers.kafka.strimzi.io created
deployment.extensions/strimzi-cluster-operator created
```

# Helm Chart Configuration

The Helm Chart contains configuration that can be overridden by the user to suit their needs.
The full set of configuration that can be passed to this Chart can be found in the Chart's [`values.yaml`](https://github.com/strimzi/strimzi-kafka-operator/blob/master/helm-charts/strimzi-kafka-operator/values.yaml) file and documented in the Chart's [`README.md`](https://github.com/strimzi/strimzi-kafka-operator/blob/master/helm-charts/strimzi-kafka-operator/README.md).

To explore the different ways to override Helm Chart values consult the Helm documentation's [Helm Install](https://docs.helm.sh/helm/#helm-install) section.

Commonly used configuration scenarios are discussed next.

## Using a Private Docker Registry

The Helm Chart allows you to configure docker image coordinates for all the images used within Strimzi.
By default these images are retrieved from the [`strimzi`](https://hub.docker.com/u/strimzi/) DockerHub user with a tag that's the same as the version of the Strimzi release that's being installed.
However, if you would like to cache the Chart locally, or if you've made any changes to the underlying docker images being used by Strimzi, then you can override both the repository and tag for all docker images.

For example, if you host a private docker registry with a hostname of `registry.xyzcorp.com` and a custom tag of `0.8.2-XYZCORP` then you can override the docker images used by your Strimzi Cluster Operator by overriding the `imageRepositoryOverride` and `imageTagOverride` values during installation.  The example below demonstrates how

```
helm install strimzi/strimzi-kafka-operator \
--name my-strimzi-release \
--namespace strimzi \
--version 0.8.2 \
--set imageRepositoryOverride=registry.xyzcorp.com \
--set imageTagOverride=0.8.2-XYZCORP
```

In this example, the Cluster Operator docker image coordinates would be: `registry.xyzcorp.com/cluster-operator:0.8.2-XYZCORP`, as opposed to the default of `strimzi/cluster-operator:0.8.2`.

## Configure Cluster Operator to watch multiple Namespaces or Projects

By default the Cluster Operator will only watch for `Kafka` resources created or updated within the namespace the Cluster Operator is running in.
If you wish to create `Kafka` resources in a different namespace from your Cluster Operator, or if you wish to watch multiple namespaces, then you can add them as a comma-delimited list for the `watchNamespaces` value override.

The Cluster Operator _will always_ watch for Kafka resources created in the namespace it's installed into.

For example, to watch in namespaces `strimzi`, `foo`, and `bar` you can install the Cluster Operator like this.

```
helm install strimzi/strimzi-kafka-operator \
--name my-strimzi-release \
--namespace strimzi \
--set watchNamespaces="{foo,bar}"
```

The Chart will install several more resources to Kubernetes than it normally does to be able to watch the additional namespaces.
Additional `RoleBindings` will be created in each additional namespace so that the Cluster Operator has the correct permissions to watch for `Kafka` resources created, and each Entity Operator component (topic-operator, user-operator, etc.) has permissions to watch for their respective resources created in those namespaces.
You will see these additional resources created in the summary of resources created as part of the `helm install` command.

For the previous example you can view all the `RoleBindings` created in specific namespaces with the following command.

```bash
$ kubectl get rolebinding -l release=my-strimzi-release --all-namespaces
NAMESPACE   NAME                                                  AGE
bar         strimzi-cluster-operator                              7m
bar         strimzi-cluster-operator-entity-operator-delegation   7m
bar         strimzi-cluster-operator-topic-operator-delegation    7m
foo         strimzi-cluster-operator                              7m
foo         strimzi-cluster-operator-entity-operator-delegation   7m
foo         strimzi-cluster-operator-topic-operator-delegation    7m
strimzi     strimzi-cluster-operator                              7m
strimzi     strimzi-cluster-operator-entity-operator-delegation   7m
strimzi     strimzi-cluster-operator-topic-operator-delegation    7m
```

## Updating a running Cluster Operator Configuration

If you want to update the value overrides you supplied to the `helm install` command you can use the [`helm upgrade`](https://docs.helm.sh/helm/#helm-upgrade) command to update just the values you want.  An upgrade command requires the Release name and Chart coordinate.

When an update is done, all the resources created by the Chart will be regenerated and applied (if necessary).

For example, to add an additional namespace to be watched by the Cluster Operator you can provide an updated list.
In this case, because the `Deployment` for the Cluster Operator is regenerated and applied (because that's where the `watchNamespaces` configuration is defined for the Cluster Operator), it will automatically trigger the Cluster Operator pod to restart and use the new configuration.
In this example we add an additional namespace `baz` which will trigger an update to the Cluster Operator `Deployment` as well as create the necessary `RoleBindings` in the `baz` namespace.

```
helm upgrade \
--reuse-values \
--set watchNamespaces="{foo,bar,baz}" \
my-strimzi-release strimzi/strimzi-kafka-operator
```

You can now create a `Kafka` resource in the `baz` namespace and the Cluster Operator will create a Kafka and ZooKeeper cluster there.

In subsequent releases the `helm upgrade` command will be used to actually upgrade the Cluster Operator to the next supported version, but this is an unsupported operation at this time.

# Conclusion

This blog post has explored how Helm can be used to easily manage your Strimzi installation.
We discussed what Helm is and how to use it to install, update, and manage the configuration of the Cluster Operator.
Helm may be used as an easy way for a Kafka developer to get started, but it's also appropriate to manage Strimzi in a production-like setting.
We encourage users to submit feedback about their experience with the Chart so it can be made even better in future releases.
