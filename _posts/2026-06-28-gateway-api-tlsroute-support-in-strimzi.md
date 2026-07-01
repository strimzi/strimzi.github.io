---
layout: post
title: "Gateway API and TLSRoute support in Strimzi"
date: 2026-06-28
author: paolo_patierno
---

Exposing Apache Kafka to clients running outside a Kubernetes cluster has always required some creative plumbing.
Over the years, Strimzi has accumulated four external listener types (`nodeport`, `loadbalancer`, `route` for OpenShift only, and `ingress`), and they each come with their own trade-offs.
The `ingress` type deserves special mention here, because it was recently deprecated and the story behind that deprecation is exactly what motivates this post.

The `type: ingress` listener relied on the [Ingress NGINX Controller for Kubernetes](https://github.com/kubernetes/ingress-nginx), a project that was [announced for retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/) by the Kubernetes community.
It was actually archived on the stage during KubeCon EU Amsterdam this year, and I was there!
With no future investment planned for that controller, building on top of it is no longer a good idea.
Fortunately, the Kubernetes ecosystem has a well-supported successor: the **Gateway API**.

Starting with Strimzi 1.0, the operator natively supports a new external listener type (`type: tlsroute`) based on the Kubernetes Gateway API and its `TLSRoute` resource.
In this post we will look at what the Gateway API is, why `TLSRoute` is the right fit for Kafka traffic, and then walk through a fully working example on **minikube** using [Envoy Gateway](https://gateway.envoyproxy.io/) as the Gateway controller.

### From Ingress to Gateway API

The `Ingress` resource was the original Kubernetes abstraction for north-south HTTP traffic.
It was never designed for non-HTTP protocols and, as a result, anyone trying to expose Kafka through it had to rely on vendor-specific annotations and implementation quirks.

The [Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/) was created to be a proper successor.
It is an official Kubernetes SIG project that defines a set of standard Custom Resource Definitions for routing L4 and L7 traffic.
It ships *only* the API specification; the actual data-plane work is delegated to Gateway controller implementations, of which there are [many](https://gateway-api.sigs.k8s.io/implementations/).
This clean separation means you can swap controllers without changing your application-level configuration.

The Gateway API introduces a hierarchy of resources:

* **`GatewayClass`**: a cluster-scoped resource that names a specific controller (comparable to `IngressClass`).
* **`Gateway`**: an instance of a load balancer / proxy configured to handle traffic according to a `GatewayClass`.
* **Route resources** (`HTTPRoute`, `GRPCRoute`, `TLSRoute`, `TCPRoute`, …): describe how traffic should be forwarded from the gateway to backend services.

### Why TLSRoute?

Kafka speaks its own binary protocol over TCP, not HTTP or gRPC, so `HTTPRoute` and `GRPCRoute` are immediately ruled out.
That leaves `TCPRoute` and `TLSRoute`.

`TCPRoute` routes arbitrary TCP traffic based solely on the destination port.
This means you need a unique IP address *or* a unique port for every broker you want to expose, effectively 1 + N addresses/ports for a cluster with N brokers.
At any meaningful scale that quickly becomes unmanageable.

`TLSRoute` solves this elegantly by using **TLS-SNI** (Server Name Indication) to route traffic.
Because Kafka clients always open a TLS-encrypted connection to the broker (when TLS is enabled), the client hostname is present in the TLS handshake *before* any Kafka protocol bytes are exchanged.
The gateway reads the SNI hostname and decides which backend service to forward the connection to.
This means that one gateway address and one port can serve the bootstrap endpoint *and* every individual broker, distinguished purely by hostname.

`TLSRoute` moved to the **Standard** API channel in Gateway API v1.4 and got a stable `v1` API version in v1.5, making it a solid foundation to build on.

### How Strimzi uses TLSRoute

When you configure a `type: tlsroute` listener, the Strimzi Cluster Operator takes care of all the Gateway API plumbing on your behalf:

* A **bootstrap service** pointing to all brokers is created, along with a **bootstrap `TLSRoute`** for the bootstrap hostname.
* A **per-broker service** and a **per-broker `TLSRoute`** are created for each Kafka broker node, using the per-broker hostname.

You only need to:

1. Deploy and configure a `Gateway` (using any Gateway API compatible controller).
2. Reference that `Gateway` in your `Kafka` CR via the new `parentRefs` configuration field.

Strimzi will create and keep the `TLSRoute` resources in sync.
This is especially useful when you combine `type: tlsroute` with horizontal auto-scaling of broker node pools: as brokers are added or removed, Strimzi automatically creates or deletes the corresponding `TLSRoute` resources.

> **TLS passthrough vs. TLS termination**: the TLS mode is configured on the `Gateway` listener, not in Strimzi. With TLS *passthrough*, the encrypted connection travels all the way to the Kafka broker; the broker's certificate is what clients verify. This is what we use in this guide and is the most common setup. TLS *termination* at the gateway is also possible in principle, but Gateway API controller support for it is still emerging.

### Trying it on minikube

The rest of this post is a step-by-step walkthrough for running the `type: tlsroute` listener on a laptop using minikube and Envoy Gateway.
At the end you will be able to produce and consume messages from outside the cluster using the standard Kafka client tools.

We assume minikube is already running locally. If you need to set it up first, follow the [minikube getting started guide](https://minikube.sigs.k8s.io/docs/start/).

#### Prerequisites

You will need the following tools installed:

* [kubectl](https://kubernetes.io/docs/tasks/tools/)
* [Helm 3](https://helm.sh/docs/intro/install/)
* Strimzi 1.0.0+ installed in your cluster (the [Quickstart](https://strimzi.io/quickstarts/) is the fastest path)
* Kafka CLI tools (`kafka-topics.sh`, `kafka-console-producer.sh`, `kafka-console-consumer.sh`); alternatively, you can run them from inside a broker pod

#### Step 1: Install Envoy Gateway

Envoy Gateway ships with the Gateway API CRDs bundled, so there is no need to install them separately.

```bash
helm install envoygateway oci://docker.io/envoyproxy/gateway-helm \
  -n envoy-gateway-system --create-namespace

kubectl wait --timeout=5m -n envoy-gateway-system \
  deployment/envoy-gateway --for=condition=Available
```

Verify the installation and confirm that the Gateway API CRDs are present:

```bash
kubectl get pods -n envoy-gateway-system
kubectl get crd | grep gateway
```

You should see several CRDs including `gateways.gateway.networking.k8s.io` and `tlsroutes.gateway.networking.k8s.io`.

#### Step 2: Create the EnvoyProxy resource

The `EnvoyProxy` resource tells Envoy Gateway how to deploy the data-plane Envoy pods and what service type to use.
On minikube we use `LoadBalancer` and rely on `minikube tunnel` to expose it.

```yaml
# envoy-proxy.yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: EnvoyProxy
metadata:
  name: minikube-proxy
  namespace: envoy-gateway-system
spec:
  provider:
    type: Kubernetes
    kubernetes:
      envoyService:
        type: LoadBalancer
```

```bash
kubectl apply -f envoy-proxy.yaml
```

#### Step 3: Create the GatewayClass

A `GatewayClass` is a cluster-scoped resource that registers a specific Gateway controller with Kubernetes, much like `IngressClass` does for Ingress controllers.
Every `Gateway` you create later must reference a `GatewayClass`, which is how Kubernetes knows which controller should reconcile it.

The `controllerName` field identifies the Envoy Gateway controller, and the `parametersRef` points to the `EnvoyProxy` resource we created in the previous step so that the controller knows how to deploy the data-plane pods.

```yaml
# gateway-class.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: envoy-gateway
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
  parametersRef:
    group: gateway.envoyproxy.io
    kind: EnvoyProxy
    name: minikube-proxy
    namespace: envoy-gateway-system
```

```bash
kubectl apply -f gateway-class.yaml
kubectl get gatewayclass
```

The output should show the `GatewayClass` with `ACCEPTED` set to `True`, which means the Envoy Gateway controller has picked it up successfully.

#### Step 4: Start minikube tunnel

The `LoadBalancer` service created for the gateway needs an external IP.
Open a **new terminal** and keep this command running throughout the session:

```bash
minikube tunnel
```

You may be prompted for your `sudo` password.
Leave this terminal open and go back to your main terminal.

#### Step 5: Create the Gateway

A `Gateway` is an instance of a load balancer or proxy that listens for incoming traffic and routes it to backend services based on the attached route resources.
It references a `GatewayClass` (via `gatewayClassName`) so Envoy Gateway knows it is responsible for reconciling this resource and deploying the corresponding Envoy proxy pods.

The listener we define here is the entry point for all Kafka traffic:

* `protocol: TLS` with `mode: Passthrough` tells the gateway to forward the raw TLS connection directly to the backend without terminating it. The TLS handshake happens end-to-end between the Kafka client and the Kafka broker.
* `port: 8443` is the port on which the gateway will accept connections from outside the cluster.
* `hostname: "*.kafka.local"` restricts this listener to SNI hostnames matching that wildcard, which covers both the bootstrap address and all per-broker addresses we will configure later.
* `allowedRoutes.namespaces.from: All` permits `TLSRoute` resources from any namespace to attach to this listener, which is needed because Strimzi will create the routes in the Kafka cluster's namespace.

```yaml
# gateway.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: envoy-gateway
  namespace: envoy-gateway-system
spec:
  gatewayClassName: envoy-gateway
  listeners:
    - name: tls-passthrough
      protocol: TLS
      port: 8443
      hostname: "*.kafka.local"
      tls:
        mode: Passthrough
      allowedRoutes:
        namespaces:
          from: All
```

```bash
kubectl apply -f gateway.yaml
```

Wait a few seconds and then verify the Gateway is `PROGRAMMED`:

```bash
kubectl get gateway envoy-gateway -n envoy-gateway-system
```

If `PROGRAMMED` shows `False`, check that `minikube tunnel` is still running and that the LoadBalancer service has been assigned an `EXTERNAL-IP`:

```bash
kubectl get svc -n envoy-gateway-system
```

#### Step 6: Configure DNS

Because we are running on a laptop, there is no real DNS server that can resolve the Kafka hostnames to the gateway's address.
We solve this by adding static entries to the local `/etc/hosts` file.
This is the same technique used when doing local Kubernetes development: map the hostnames you care about directly to the IP exposed by `minikube tunnel`.

The hostnames we need come from the Kafka listener configuration we will apply in Step 7.
The `bootstrap.host` field sets the bootstrap address (`bootstrap.kafka.local`), and the `hostTemplate` field defines the per-broker naming pattern (`broker-{nodeId}.kafka.local`), which for a three-broker cluster produces `broker-0.kafka.local`, `broker-1.kafka.local`, and `broker-2.kafka.local`.
We add all four entries now so that the cluster is reachable as soon as it finishes reconciling.

First, retrieve the external IP that was assigned to the gateway:

```bash
GATEWAY_IP=$(kubectl get gateway envoy-gateway -n envoy-gateway-system \
  -o jsonpath='{.status.addresses[0].value}')
echo $GATEWAY_IP
```

Add entries to `/etc/hosts` so your laptop can resolve the Kafka hostnames:

```bash
sudo tee -a /etc/hosts <<EOF
${GATEWAY_IP} bootstrap.kafka.local
${GATEWAY_IP} broker-0.kafka.local
${GATEWAY_IP} broker-1.kafka.local
${GATEWAY_IP} broker-2.kafka.local
EOF
```

You can verify that DNS resolves correctly with:

```bash
ping -c 1 bootstrap.kafka.local
```

Note that the ping itself will likely time out (the gateway only listens on TCP); what matters is that the hostname resolves to the right IP.

#### Step 7: Deploy the Kafka cluster with a tlsroute listener

We assume the Strimzi Cluster Operator is installed in the `kafka` namespace and we will deploy the Kafka cluster there as well.

Create the `Kafka` and `KafkaNodePool` resources.
The key part is the `external` listener of `type: tlsroute`, which instructs Strimzi to create `TLSRoute` resources instead of managing `Ingress` or `LoadBalancer` objects itself.

A few fields in the listener configuration are worth calling out:

* `parentRefs` points to the `Gateway` resource created in Step 5. This is how Strimzi knows which gateway to attach the `TLSRoute` resources to.
* `bootstrap.host` sets the hostname advertised to Kafka clients for the initial connection.
* `hostTemplate` defines the per-broker hostname pattern. The `{nodeId}` placeholder is replaced by the actual broker node ID at runtime.
* `advertisedPortTemplate: 8443` fixes the advertised port to `8443` for every broker, matching the single port our gateway listener is configured on.

```yaml
# kafka-cluster.yaml
apiVersion: kafka.strimzi.io/v1
kind: KafkaNodePool
metadata:
  name: controller
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  roles:
    - controller
  storage:
    type: jbod
    volumes:
      - id: 0
        type: ephemeral
        kraftMetadata: shared
---
apiVersion: kafka.strimzi.io/v1
kind: KafkaNodePool
metadata:
  name: broker
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  roles:
    - broker
  storage:
    type: jbod
    volumes:
      - id: 0
        type: ephemeral
        kraftMetadata: shared
---
apiVersion: kafka.strimzi.io/v1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    version: 4.3.0
    metadataVersion: 4.3-IV0
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: tls
        port: 9093
        type: internal
        tls: true
      - name: external
        port: 9094
        type: tlsroute
        tls: true
        configuration:
          bootstrap:
            host: bootstrap.kafka.local
          parentRefs:
            - kind: Gateway
              group: gateway.networking.k8s.io
              name: envoy-gateway
              namespace: envoy-gateway-system
          hostTemplate: broker-{nodeId}.kafka.local
          advertisedPortTemplate: "8443"
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
      default.replication.factor: 3
      min.insync.replicas: 2
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

```bash
kubectl apply -f kafka-cluster.yaml -n kafka
kubectl wait kafka/my-cluster -n kafka --for=condition=Ready --timeout=300s
```

Once the cluster is ready, verify that Strimzi has created the `TLSRoute` resources automatically in the `kafka` namespace:

```bash
kubectl get tlsroute -n kafka
```

You should see one bootstrap route and one route per broker:

```
NAME                              HOSTNAMES                        AGE
my-cluster-kafka-bootstrap        ["bootstrap.kafka.local"]        2m
my-cluster-broker-0               ["broker-0.kafka.local"]         2m
my-cluster-broker-1               ["broker-1.kafka.local"]         2m
my-cluster-broker-2               ["broker-2.kafka.local"]         2m
```

> **Tip**: If the `TLSRoute` resources are not created and the Cluster Operator logs show `The Gateway API TLSRoute resource is not available in this Kubernetes cluster`, the operator was started before the Gateway API CRDs were installed. Simply restart it (replace `<operator-namespace>` with the namespace where Strimzi is installed, e.g. `strimzi` if you used the Quickstart):
> ```bash
> kubectl rollout restart deployment strimzi-cluster-operator -n <operator-namespace>
> ```

#### Step 8: Test the connection

Before connecting Kafka clients, we need to extract the cluster CA certificate that Strimzi generated for the cluster.
Clients must trust this CA to be able to establish a TLS connection to the brokers.

```bash
kubectl get secret my-cluster-cluster-ca-cert -n kafka \
  -o jsonpath='{.data.ca\.crt}' | base64 -d > ca.crt
```

With the CA certificate in hand, do a quick sanity check with OpenSSL to verify the TLS passthrough is working end to end:

```bash
openssl s_client -connect broker-0.kafka.local:8443 \
  -servername broker-0.kafka.local -showcerts
```

You should see `CONNECTED` and the broker certificate chain.
A `Verify return code: 19 (self-signed certificate in certificate chain)` is expected; the important thing is that the TLS handshake completes successfully.

Now test with the Kafka CLI tools.
All commands need to know the bootstrap address and that TLS is required, so start by creating a client properties file that every tool will share via `--command-config` or `--producer.config` / `--consumer.config`:

```properties
# client-ssl.properties
bootstrap.servers=bootstrap.kafka.local:8443
security.protocol=SSL
ssl.truststore.type=PEM
ssl.truststore.location=ca.crt
```

The `ssl.truststore.location` points to the `ca.crt` file we just extracted.
Using `ssl.truststore.type=PEM` means we can pass the certificate file directly without converting it to a Java keystore first.

First, verify that the client can reach the cluster and list topics.
At this point the list will be empty, but a successful response confirms that the bootstrap connection and broker metadata exchange are working correctly:

```bash
kafka-topics.sh --bootstrap-server bootstrap.kafka.local:8443 \
  --command-config client-ssl.properties \
  --list
```

Next, create a test topic with three partitions and a replication factor of three, one replica per broker:

```bash
kafka-topics.sh --bootstrap-server bootstrap.kafka.local:8443 \
  --command-config client-ssl.properties \
  --create --topic test-topic \
  --partitions 3 --replication-factor 3
```

With the topic in place, open an interactive producer session and type a few messages, pressing Enter after each one.
Press `Ctrl+C` when you are done to close the producer:

```bash
kafka-console-producer.sh --bootstrap-server bootstrap.kafka.local:8443 \
  --producer.config client-ssl.properties \
  --topic test-topic
```

Finally, start a consumer reading from the beginning of the topic.
It should print every message you just produced, which confirms that the per-broker `TLSRoute` resources are working correctly.
Each message was written to a specific broker and the consumer was able to reach that broker individually through its own dedicated route:

```bash
kafka-console-consumer.sh --bootstrap-server bootstrap.kafka.local:8443 \
  --consumer.config client-ssl.properties \
  --topic test-topic \
  --from-beginning
```

Press `Ctrl+C` to stop the consumer once you have seen all the messages.

### Conclusion

The new `type: tlsroute` listener brings first-class Gateway API support to Strimzi.
It fills the gap left by the deprecated `type: ingress` listener and does so on a stable, vendor-neutral standard that has broad ecosystem support.

From a user perspective, the configuration is straightforward: bring your own `Gateway`, point Strimzi at it via `parentRefs`, and Strimzi takes care of creating and maintaining the `TLSRoute` resources, including as brokers are scaled up or down.

From a protocol perspective, TLS-SNI-based routing gives you the clean one-address-one-port topology that is so important for the Kafka protocol, without the complexity of managing one unique IP per broker that `TCPRoute` would require.

If you are currently using `type: ingress` and wondering what to migrate to, `type: tlsroute` is the answer.
Any [Gateway API compatible controller](https://gateway-api.sigs.k8s.io/implementations/) will work; in this post we used Envoy Gateway, but you could equally use Cilium Gateway API, Istio, NGINX Gateway Fabric, or any other implementation you already have in your cluster.

For more background on the design decisions behind this feature, have a look at [Strimzi proposal #136](https://github.com/strimzi/proposals/blob/main/136-tls-route-listener.md).
