---
layout: post
title: "Collecting diagnostic data"
date: 2025-03-17
author: federico_valeri
---

Debugging distributed systems like Apache Kafka can be challenging.
Without access to the right diagnostic data, identifying the root cause of an issue can become a time-consuming process.
Strimzi, the Kubernetes-native Kafka operator, provides a [bash script](https://github.com/strimzi/strimzi-kafka-operator/blob/0.45.0/tools/report.sh) to collect cluster artifacts, including logs and configurations.

Sometimes, this is not enough and we need long-term storage to collect custom and advanced diagnostic data such as heap dumps and flame graphs.
Fortunately, Strimzi recently introduced the **additional volumes** feature that makes this task really easy.

<!--more-->

### The need for diagnostic data in Kafka troubleshooting

Kafka clusters can encounter a range of issues, from resource exhaustion to unexpected application crashes.
When these issues arise, collecting relevant diagnostic data such as logs, metrics, heap dumps, and thread dumps is essential for effective debugging.
Without this information, developers are left guessing, often leading to unnecessary downtime and prolonged resolutions.

Common diagnostic artifacts needed for debugging Kafka and Java application in general include:

- **Heap dumps**: To analyze memory usage and detect memory leaks.
- **Thread dumps**: To inspect thread states and potential deadlocks.
- **JVM metrics**: To monitor CPU, memory, and GC activity.
- **Log files**: To track application errors and warnings.
- **Flame graphs**: To visually identify performance bottlenecks.

Strimzi makes it easier to capture these artifacts by leveraging Kubernetes-native mechanisms such as persistent volumes.

### Introducing Strimzi additional volumes

The additional volumes feature, introduced via [proposal 75](https://github.com/strimzi/proposals/blob/main/075-additional-volumes-support.md), allows users to define extra storage volumes in all operands.
This enhancement supports different types of volumes, but here we are interested in `PersistentVolumeClaims` to durably store and retrieve any kind of diagnostic data under the `/mnt` mount point.

With additional volumes, users can:

- Mount persistent or ephemeral storage for logs, dumps, or other debugging artifacts.
- Capture JVM dumps without modifying the default storage configuration.
- Enable better debugging workflows by keeping artifacts accessible even after a pod restart.

### Example: capturing heap dumps with additional volumes

A practical example of how additional volumes simplify debugging is demonstrated in the following procedure.
The scenario involves collecting heap dumps from a Kafka broker when observing excessive memory consumption.
Memory leaks can sometimes lead to out of memory exceptions (OOME) and service disruption.

> [!WARNING]
> Taking a heap dump is a heavy operation that makes the Java application hangs.
> It is not recommended in production, unless it is not possible to reproduce the memory issue in a lower environment.

1. **Create the volume claim**: create a persistent volume claim of the desired size, which is bound to a persistent volume:

    ```sh
    kind: PersistentVolumeClaim
    metadata:
      name: my-pvc
    spec:
      accessModes:
        - ReadWriteOnce
      resources:
        requests:
          storage: 10Gi
      storageClassName: standard
    ```

2. **Configure the additional volume**: edit the Kafka resource definition to include an extra volume (rolling update):

    ```sh
    spec:
      kafka:
        template:
            pod:
              volumes:
                - name: my-volume
                  persistentVolumeClaim:
                    claimName: my-pvc
            kafkaContainer:
              volumeMounts:
                - name: my-volume
                  mountPath: "/mnt/data"
    ```

3. **Trigger the heap dump generation**: use the `jcmd` tool to generate a heap dump inside the mounted directory.

    ```sh
    $ PID="$(kubectl exec my-cluster-broker-5 -- jcmd | grep "kafka.Kafka" | awk '{print $1}')" && \
      kubectl exec my-cluster-broker-5 -- jcmd "$PID" GC.heap_dump /mnt/data/heap.hprof
    724:
    Dumping heap to /mnt/data/heap.hprof ...
    Heap dump file created [179236580 bytes in 0.664 secs]
    ```

4. **Retrieve the heap dump file**: use the `kubectl` tool to copy the heap dump file to your local machine for analysis.

    ```sh
    $ kubectl cp my-cluster-broker-5:/mnt/data/heap.hprof "$HOME"/Downloads/heap.hprof
    tar: Removing leading `/' from member names
    ```

5. **Analyze the heap dump**: use tools like [Eclipse Memory Analyzer](https://eclipse.dev/mat) to investigate the memory issue.

### Conclusion

Strimzi’s additional volumes feature is a powerful enhancement that simplifies debugging by making it easier to store and retrieve diagnostic data.
As shown in the heap dump example, this feature allows developers to quickly capture essential debugging artifacts without modifying Kafka’s core configurations.
By leveraging Strimzi’s built-in capabilities, teams can reduce downtime and improve the reliability of their Kafka deployments.

For more details, check out the Strimzi documentation.
Happy debugging!
