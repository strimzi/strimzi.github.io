---
layout: post
title:  "Resizing persistent volumes with Strimzi"
date: 2019-02-28
author: jakub_scholz
---

_Warning: 
The instructions in this blog post do not apply to Strimzi version 0.12 and higher.
Strimzi now supports resizing of persistent volumes directly via the `Kafka` CR or in more recent versions `KafkaNodePool` CR.
Please refer to the [resizing documentation](https://strimzi.io/docs/operators/latest/deploying#proc-resizing-persistent-volumes-str) for your Strimzi version for the relevant instructions._

Do you know the feeling when you run out of disk space?
When you want to save some new data to your disk but there is not enough space?
It has probably happened to most of us at least once in our life.
So, what should you do when this happens to your Kafka cluster?

<!--more-->

_Note:
Support for resizing volumes depends on the version of your Kubernetes or OpenShift cluster and on the infrastructure it runs on.
The steps described in this article were tested with OpenShift 4 on Amazon AWS, but they should be compatible with Kubernetes 1.11+ and OpenShift 3.11+.
If you want to try OpenShift 4, check out the [Developer Preview](https://try.openshift.com/)._

In an ideal case, you would just edit the `Kafka` custom resource and increase the size of the persistent volume.
Unfortunately, Strimzi currently doesn't support automatic resizing of persistent volumes.
So if you change the size of the persistent volume all you will get back will be an error message in the Cluster Operator logs telling you that you are not allowed to change storage configuration.

Luckily, you can still increase your volume size manually.
To see how to do it, we have to first deploy the Kafka cluster.
We can use the following Kafka resource, which is one of our examples:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    version: 2.1.1
    replicas: 3
    listeners:
      plain: {}
      tls: {}
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
      log.message.format.version: "2.1"
    storage:
      type: persistent-claim
      size: 100Gi
      deleteClaim: false
  zookeeper:
    replicas: 3
    storage:
      type: persistent-claim
      size: 100Gi
      deleteClaim: false
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

As you can see, it is requesting 100Gi persistent volumes for both Kafka and Zookeeper.
After you create the resource, your Kafka cluster will be deployed.
You can check that it created 6 Persistent Volume Claims.
And each of them looks something like this:

```yaml
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  annotations:
    pv.kubernetes.io/bind-completed: 'yes'
    pv.kubernetes.io/bound-by-controller: 'yes'
    strimzi.io/delete-claim: 'false'
    volume.beta.kubernetes.io/storage-provisioner: kubernetes.io/aws-ebs
  selfLink: /api/v1/namespaces/my-kafka/persistentvolumeclaims/data-my-cluster-kafka-0
  resourceVersion: '42035'
  name: data-my-cluster-kafka-0
  uid: 68b4be67-3a8a-11e9-bf2b-067919d3dbb8
  creationTimestamp: '2019-02-27T12:22:54Z'
  namespace: my-kafka
  finalizers:
    - kubernetes.io/pvc-protection
  labels:
    strimzi.io/cluster: my-cluster
    strimzi.io/kind: Kafka
    strimzi.io/name: my-cluster-kafka
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  volumeName: pvc-68b4be67-3a8a-11e9-bf2b-067919d3dbb8
  storageClassName: gp2
  dataSource: null
status:
  phase: Bound
  accessModes:
    - ReadWriteOnce
  capacity:
    storage: 100Gi
```

You can notice that it specifies the disk size - 100Gi - in the specification as the requested size.
It also lists the actual capacity in the `status`.
Again, this is 100Gi.
When you open a terminal into one of the Kafka pods, you can also check the disk capacity using the `df` command.

```console
$ df -h
Filesystem      Size  Used Avail Use% Mounted on
overlay         120G  4.7G  116G   4% /
tmpfs            64M     0   64M   0% /dev
tmpfs           3.9G     0  3.9G   0% /sys/fs/cgroup
shm              64M     0   64M   0% /dev/shm
tmpfs           3.9G  6.2M  3.9G   1% /run/secrets
/dev/xvda2      120G  4.7G  116G   4% /etc/hosts
tmpfs           3.9G  4.0K  3.9G   1% /opt/kafka/cluster-ca-certs
tmpfs           3.9G   24K  3.9G   1% /opt/kafka/broker-certs
tmpfs           3.9G  4.0K  3.9G   1% /opt/kafka/client-ca-certs
/dev/xvdbe       99G   61M   99G   1% /var/lib/kafka/data
tmpfs           3.9G   12K  3.9G   1% /run/secrets/kubernetes.io/serviceaccount
tmpfs           3.9G     0  3.9G   0% /proc/acpi
tmpfs           3.9G     0  3.9G   0% /proc/scsi
tmpfs           3.9G     0  3.9G   0% /sys/firmware
```

Notice the volume `/dev/xvdbe` which is the persistent volume with the Kafka message logs and has total capacity of 99G.
As you can see I have still a lot of free disk space.
But I want to increase the disk size anyway.
Let's say to 200Gi.

As the first step, I have to go to the Persistent Volume Claims and edit the requested capacity.
In my case I will change the requested capacity from 100Gi to 200Gi.
You can apply this change to all PVC of your Kafka cluster.

```yaml
# ...
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 200Gi
  volumeName: pvc-68b4be67-3a8a-11e9-bf2b-067919d3dbb8
  storageClassName: gp2
  dataSource: null
# ...
```

After you apply these changes, the `status` field of the PVC should change to something like this:

```yaml
#...
status:
  phase: Bound
  accessModes:
    - ReadWriteOnce
  capacity:
    storage: 100Gi
  conditions:
    - type: Resizing
      status: 'True'
      lastProbeTime: null
      lastTransitionTime: '2019-02-27T12:25:15Z'
```

As you can see, the capacity is still 100Gi, but Kubernetes / OpenShift is now resizing the volume.
Once the resizing of the volume is finished, the `status` will change to this:

```yaml
# ...
status:
  phase: Bound
  accessModes:
    - ReadWriteOnce
  capacity:
    storage: 100Gi
  conditions:
    - type: FileSystemResizePending
      status: 'True'
      lastProbeTime: null
      lastTransitionTime: '2019-02-27T12:25:30Z'
      message: >-
        Waiting for user to (re-)start a pod to finish file system resize of
        volume on node.
```

As you can read in the message, the volume has been resized.
But the file system is still only 100Gi big and needs to be resized as well.
The resizing of the file system cannot be done while the pod is running - it will be done automatically when the pod is restarted. 

The easiest way to restart the Kafka pods to resize the file system is to tell Strimzi to perform a rolling update of the Kafka Statefulset.
You can do that using the [`strimzi.io/manual-rolling-update=true`annotation](https://strimzi.io/docs/latest/full.html#proc-manual-rolling-update-kafka-deployment-configuration-kafka).

```console
kubectl annotate statefulset cluster-name-kafka strimzi.io/manual-rolling-update=true
```

After you set this annotation, Strimzi will roll all the Kafka pods one by one.
It might take Strimzi up to one reconciliation interval (environment variable `STRIMZI_FULL_RECONCILIATION_INTERVAL_MS` in Cluster Operator deployment) to notice the annotation.
While the pods are being restarted, the filesystem will be resized.
In case you already ran out of disk space and your Kafka pods are crash-looping, you might need to delete the pods manually.
If you check your PVCs after the restart is finished, you should see something like this:

```yaml
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  annotations:
    pv.kubernetes.io/bind-completed: 'yes'
    pv.kubernetes.io/bound-by-controller: 'yes'
    strimzi.io/delete-claim: 'false'
    volume.beta.kubernetes.io/storage-provisioner: kubernetes.io/aws-ebs
  selfLink: /api/v1/namespaces/my-kafka/persistentvolumeclaims/data-my-cluster-kafka-0
  resourceVersion: '45337'
  name: data-my-cluster-kafka-0
  uid: 68b4be67-3a8a-11e9-bf2b-067919d3dbb8
  creationTimestamp: '2019-02-27T12:22:54Z'
  namespace: my-kafka
  finalizers:
    - kubernetes.io/pvc-protection
  labels:
    strimzi.io/cluster: my-cluster
    strimzi.io/kind: Kafka
    strimzi.io/name: my-cluster-kafka
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 200Gi
  volumeName: pvc-68b4be67-3a8a-11e9-bf2b-067919d3dbb8
  storageClassName: gp2
  dataSource: null
status:
  phase: Bound
  accessModes:
    - ReadWriteOnce
  capacity:
    storage: 200Gi
```

As you can see, the requested size is now 200Gi and the actual capacity is also now 200Gi.
We can also confirm that the disk size was increased from inside the pod:

```console
$ df -h
Filesystem      Size  Used Avail Use% Mounted on
overlay         120G  4.7G  116G   4% /
tmpfs            64M     0   64M   0% /dev
tmpfs           3.9G     0  3.9G   0% /sys/fs/cgroup
shm              64M     0   64M   0% /dev/shm
tmpfs           3.9G  6.1M  3.9G   1% /run/secrets
/dev/xvda2      120G  4.7G  116G   4% /etc/hosts
tmpfs           3.9G  4.0K  3.9G   1% /opt/kafka/cluster-ca-certs
tmpfs           3.9G   24K  3.9G   1% /opt/kafka/broker-certs
tmpfs           3.9G  4.0K  3.9G   1% /opt/kafka/client-ca-certs
/dev/xvdch      197G   60M  197G   1% /var/lib/kafka/data
tmpfs           3.9G   12K  3.9G   1% /run/secrets/kubernetes.io/serviceaccount
tmpfs           3.9G     0  3.9G   0% /proc/acpi
tmpfs           3.9G     0  3.9G   0% /proc/scsi
tmpfs           3.9G     0  3.9G   0% /sys/firmwarebin/kafka
```

The volume with Kafka message logs is now called `/dev/xvdch` and has size of 197G. If you need to resize Zookeeper volumes, you can follow the same process, just for the PVCs which belong to Zookeeper.

We hope that in one of the future versions of Strimzi we will add support for automatic resizing of persistent volumes through the operator.
But until then, you can still resize the storage manually using these simple steps and you don't have to delete the whole cluster and create a new one with bigger disks.
