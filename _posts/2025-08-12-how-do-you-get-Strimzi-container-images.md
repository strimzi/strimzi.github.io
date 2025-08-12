---
layout: post
title:  "How do you get Strimzi container images?"
date: 2025-08-12
author: jakub_scholz
---

Every Strimzi release produces two main types of artifacts:
* The installation files
* And the container images with the Strimzi binaries

The installation artifacts are pretty simple.
While they have several different forms (ZIP or TAR.GZ archives, Helm Chart, or Operator Hub submission), they are essentially just Kubernetes YAML resources used to install the Strimzi operators.

The container images are a bit more interesting.
They contain the base operating system, the Java Runtime Environment installation, the Strimzi and Kafka binaries (JARs), and so on.
And the way we distribute them is that we upload them into the container registry.
In our case, we use the [Quay.io](https://quay.io) registry service.
Strimzi users can pull the container images from the registry and use them.
But what is the best way to do that?
And what are the obvious or hidden risks?
That is what we will look into in this blog post.

<!--more-->

For a long time, I was curious about how our users use the Strimzi container images.
So recently, I created a short survey about it and asked Strimzi users on our Slack but also on our social media channels for their help.
The question I asked was this:

**How do you use Strimzi container images in production?**

And I gave the following options:
* I pull the container images directly from Strimzi's Quay.io repository
* I copy Strimzi's container images into a custom container repository
* I build container images from Strimzi sources without running System Tests
* I build container images from Strimzi sources and run System Tests
* I use a fork of Strimzi with private patches and private container images
* I use Strimzi through one of the vendors who provide their own Strimzi container images

I got 29 replies - which is not much - but it gave me some data to start with.
* 51.7% of users responded that they pull the container images directly from our Quay.io registry.
* 24.1% of users said they copy the Strimzi images from our registry into their own registry.
* 10.3% of users said they use Strimzi through one of the vendors.
* One user (3.4%) builds the container images from source without running the system tests.

None of the respondents are building Strimzi from source and running system tests.
And none of them have their own fork with their own changes.

I gave the respondents also an option to give custom answers.
And three users used this option:
* Two of them were using cache/proxy that caches the images when pulling them from our Quay.io registry.
* One user is using custom images with additional plugins, which are based on our Quay.io registry.

29 respondents does not give us a comprehensive picture of what Strimzi users are really using.
But it is the only insight I have and it provides an interesting starting point.

It is also important to say that it is not a _school test_ and there are no wrong answers.
Each of these options has some pros and cons.
And this blog post does not try to shame anyone for doing it the wrong way.
But it is important to understand what are the main differences in these options and what might be the risks related to each of them.
So let's have a look at these options and try to look at what is important about them.

### Pulling images from Quay.io

Pulling the container images directly from Quay.io is the easiest thing you can do.
You do not need to do anything special, you can use one of the available installation methods and that is it.
That is why it was also the most frequent answer.
But there are several risks which you need to accept.

Firstly, you are dependent on the availability of the Quay.io container registry.
As every service - free or paid - even the Quay registry has its good and bad days.
And when it is not available because of some outage, you will not be able to pull our container images from it.
That is probably fine if you just want to try Strimzi out in some development environment.
Hopefully, you will not give up on us, and try it out little bit later or maybe the next day.
But if it happens in production, it could cause major issues and it might be that a Quay outage will cause outage of your own applications and services as well.

Another set of risks is related to security.
You are dependent on the Strimzi project, its maintainers, and their security.
In Strimzi, we of course hope that we all have everything properly secured.
But you never know what might happen, whose computer might be hacked, what security practices are used in our CIs or by the different contributors and maintainers.
And of course, there might be some security issues in the Quay registry itself.

So, how can you mitigate these risks?

You can improve the security aspects by using the digest to pull the Strimzi images.
By default, the Strimzi installation files use tags.
For example `quay.io/strimzi/operator:0.47.0`.
But you can also pull the image based on its digest.
For example `quay.io/strimzi/operator@sha256:589c4d63641d9a944462dd682f6e5febe8b38ff55b9253949b061aca16feb154`.
The digest uniquely identifies a specific container image.
So you will always pull exactly the same container image.
When someone _hacks_ the container registry, they can easily create new fake image with some malicious code and push it under the `0.47.0` tag.
But they cannot push it under the same digest.

But it's not all nice and shiny.
Using the tag has its own advantages as well.
When the base container has some serious vulnerabilities, we will re-spin the Strimzi images and rebuild them with the CVE fixes.
When the CVEs are not directly in the Strimzi code but in one of the Linux dependencies such as OpenSSL or in the Java Runtime Environment, we can address the CVEs without a new Strimzi release.
And in such a case, we will test the new container images and push them under the same tag - e.g. `0.47.0`.
And when you are using the tag to pull the images, you will automatically pull the fixed image as well.
When you use the digest to pull the image, you will keep pulling the old version of the image that includes the CVEs.

All our containers are also [signed](https://github.com/strimzi/strimzi-kafka-operator?tab=readme-ov-file#container-signatures).
You can use the signatures to verify the containers.
We also produce [SBOM (Software Bill of Materials)](https://github.com/strimzi/strimzi-kafka-operator?tab=readme-ov-file#software-bill-of-materials-sbom) for our container images that lists all the software components included in them.
You can use this to verify that the containers really have exactly the same components they should and nothing else.

### Copying the images from Quay.io into your own registry

Another way to handle this is to take the Strimzi images from our Quay registry and copy them into your own container registry.
You can get the container images, validate them, check them for any security issues, and push them into your own registry.
Obviously, your own container registry can have outages as well.
And it might also be badly secured.
But at least you are fully in control.
So it is you who can make sure any outage is fixed as quickly as possible and it uses the right security practices.

While this does not fully solve the risks of using the Quay.io images directly, it makes sure you have the control over them.
You can also automate the process and have a pipeline that will automatically check for the CVE re-spins, validate them, scan them and pull them.
So you do not need to watch for the CVE re-spins and do everything manually.

Using a proxy/mirror/cache that will automatically keep the container images you pull from our container registry usually provides the same benefits as well.
And when you extend our container images with additional plugins and pull them into your own registry, you also follow a very similar process.

### Building Strimzi images from source code

Copying the images makes you still rely on the Strimzi releases.
Any bugs will get fixed only when Strimzi does a new release.
And any CVEs in the Linux base image will be fixed only when we do a new CVE re-spin.

The alternative to it is to build Strimzi from the source code yourself.
That will allow you to back-port the fixes to the bugs which are critical for your use-cases and configurations, but which were fixed only in newer Strimzi versions or not released yet at all.
You can even back-port new features in the same way.
Or - if you are very strict about the number of CVEs in your container images - you can also take the sources as they were released by Strimzi and use them to rebuild Strimzi container images to get the latest CVE fixes.

I would love to tell you that building Strimzi from source code is easy.
But as someone who does that almost daily and knows the Strimzi code base and build system very well, I'm not really in the position to say whether it is easy or hard for a new user.
In any case, you can find the building guide in our [GitHub repository](https://github.com/strimzi/strimzi-kafka-operator/blob/main/development-docs/DEV_GUIDE.md).

But building Strimzi from source code is not _just like that_.
How do you know that your newly built images really work?
You need to test them!
You can decide to do just some simple smoke tests, deploy some basic Apache Kafka cluster, try that it works and be done with it.
Or you can run the Strimzi system tests.
In our GitHub repository, we have a guide for how to run [them](https://github.com/strimzi/strimzi-kafka-operator/blob/main/development-docs/TESTING.md).
While running an individual system test from a developer IDE is pretty simple, for rebuilding Strimzi from source code, you should create some CI pipelines, you will need to set up some Kubernetes clusters, and so on.
You should also keep in mind that running all Strimzi system tests takes many hours.

While running the system tests might seem like a lot of effort, do not underestimate it.
Over the years, while doing many Strimzi releases and CVE re-spins, we have run into various issues.
And while it should normally not happen, sometimes even a patch release update of some inconspicuous dependency might break some feature.
So properly testing the container images is really important.

All of this applies also when you have private fork of Strimzi with some custom patches.
But if that is what you are doing, you are one of the most advanced Strimzi users, and probably already know all of this.

### Vendors

If all of the above seems like a lot of effort, you can consider one of the vendors who have products based on Strimzi.
Typically, the vendors will have dedicated teams with people who have Strimzi know-how and thanks to that will be able to help you even during the holiday season.
They will also have their own build pipelines, run the system tests for you after every build, use their own container registries with very high availability, and so on.
A good vendor will essentially do all the stuff I talked about here for you.

However, the vendors usually do not do this for free.
You might need to buy some license or subscription.
So make sure you understand the exact conditions under which you can use their products.

### Conclusion

As promised at the beginning of the blog post, we went through the different methods how to get the Strimzi container images.
And we covered the different issues and risks each of these methods might have.
Unsurprisingly, the easier way to get the binaries, the more risks and issues it poses.
And if you want some better solution, it might also mean more work from your side.

And that is why there is not a single _correct choice_.
It is really up to you to evaluate the pros and cons, consider how you use Strimzi, how much effort you are willing to invest, and decide which approach is the best for you.
It is also important to understand that while open source software like Strimzi is free and you can use it in almost any way you want, you might need to invest some time and effort to use it properly.
