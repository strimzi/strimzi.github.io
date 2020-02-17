---
layout: post
title:  "Creating Strimzi documentation assemblies"
date: 2020-02-17
author: paul_mellor
---

Good documentation tells you exactly how to do that thing you want to do as clearly as possible.
And it's a beautiful thing. Some say it’s a rare thing. Actually, there is a lot of great documentation around.
But great documentation tends to be invisible, quietly doing its job without being noticed.
You step through that entirely accurate and perfectly written procedure and move on.
Bad documentation, on the other hand, is far easier to notice. And once noticed, it is consequently ignored.  

We want the Strimzi documentation to be the great (invisible) kind.
The kind you want to return to. And we want you to help us make it that way.

<!--more-->

Before making your highly appreciated contribution to the Strimzi documentation, there are a couple of things worth noting.
The Strimzi documentation is written in **AsciiDoc** using a **modular** structure -- a lightweight language and a logical structure aimed at making the documentation easier to update and manage.

### Super simple AsciiDoc format

AsciiDoc is a lightweight markup language similar to markdown.
Like markdown, the syntax used to format the content can be picked up in minutes.
We do have guidelines in the [Strimzi Documentation Contributor Guide](https://strimzi.io/contributing/guide/#style-guide),
but Asciidoctor also provides an excellent [Asciidoc quick reference](https://asciidoctor.org/docs/asciidoc-syntax-quick-reference/).
If that’s too much to absorb,
I’m sure you’ll quickly get the gist by copying what you see in the Strimzi files.

You can use any text editor to work with AsciiDoc,
but if you are on the hunt for a decent editor geared to working with AsciiDoc, I think [Atom](https://atom.io/) takes some beating.

You can use [Asciidoctor](https://asciidoctor.org/) to build the Strimzi guides locally, or you can use the [make tooling supplied with the documentation](https://strimzi.io/contributing/guide/#make-tooling).

### Monolith to modular

If you glance at the Strimzi [documentation folder](https://github.com/strimzi/strimzi-kafka-operator/tree/master/documentation), you’ll be unsurprised to see that the Strimzi documentation isn’t written in a single file.
There’s some structure there, and not by accident.
Thrive in structure or drown in chaos, as they say.

However, it might not be immediately noticeable what the structure represents.
Essentially, it’s a reflection of the modular approach taken with the documentation.
You will see folders for guides (*Using*, *Quickstart*, *Overview*), and folders for the files that provide the content for one or more of these guides -- *assemblies* and *modules*.

Modularization separates concepts from tasks, then wraps them into an assembly.
An assembly represents a user story.
The assembly should answer a question -- the *what*, *why* and *how* of doing something specific.
As such, the assembly represents a self-contained unit of content that should be understood in isolation.

If you want to read more on modularization of documentation,
take a look at this [reference guide](https://redhat-documentation.github.io/modular-docs/).

## Creating a new documentation assembly

Okay, so how do you go about creating a new assembly?
Let’s take a look at a specific assembly I added to the Strimzi documentation to describe support for OAuth 2.0.
I worked on the assembly locally, and then pushed the content to the Strimzi repo as a pull request.

A new assembly requires:

1. [An assembly file](https://github.com/strimzi/strimzi-kafka-operator/blob/master/documentation/assemblies/oauth/assembly-oauth.adoc)
2. [Modules that contain the content](https://github.com/strimzi/strimzi-kafka-operator/tree/master/documentation/modules/oauth)

So, the first thing I did was create the assembly (`assembly-oauth.adoc`) that would house the concepts and tasks related to OAuth 2.0.
The assembly [describes how to use OAuth 2.0 token-based authentication](https://github.com/strimzi/strimzi-kafka-operator/blob/master/documentation/assemblies/oauth/assembly-oauth.adoc).
This sits in its own oauth category folder (`oauth`) under the assemblies folder.
Categories make it easier to find related material.

````
documentation
└── assemblies
      └── oauth
            └── assembly-oauth.adoc
````

Assemblies are kept separate from the modules that form the content.
Modules can include _concepts_ to provide understanding, _procedures_ to describe the steps to accomplish certain tasks, and related _reference_ data or information, often in lists or tables.

As with each file that’s added to the documentation,
the assembly file required a title and an ID that’s used whenever a cross-reference to the file is needed.
We also add a comment to list the files that include an assembly or module:

````
// This assembly is included in the following assemblies:
//assembly-deployment-configuration.adoc

[id='assembly-oauth_{context}']
= Using {oauth} token-based authentication
````

The _{context}_ suffix in the ID is a variable that is set at the `master.adoc` or assembly level,
and is used to avoid duplication errors at build time when an assembly or module is reused.

I could now build up the modules for the assembly. Again, I created a category for the modules, but this time under modules.

````
documentation
└── modules
      └──oauth
           ├── con-oauth-authentication-broker.adoc
           ├── con-oauth-authentication-client.adoc
           ├── con-oauth-authentication-client-options.adoc
           ├── con-oauth-authentication-flow.adoc
           ├── con-oauth-config.adoc
           ├── con-oauth-server-examples.adoc
           ├── proc-oauth-broker-config.adoc
           ├── proc-oauth-client-config.adoc
           ├── proc-oauth-kafka-config.adoc
           └── proc-oauth-server-config.adoc
 ````

The concept files are prefixed with *con* and the procedures with *proc* to distinguish them. (A reference file gets a *ref*.) The concepts files provide context and an overview of what Oauth 2.0 is and how it operates. The split between the files is where the content naturally moves on to a new topic. Procedures describe a specific task related to Oauth 2.0. It might help to think of each of these files as representing a title in the table of contents.

With my draft content written, I added the modules to the assembly. I created a symlink to `../modules/oauth` from `assemblies/oauth` to make it easier to navigate related content in Atom, but also to simplify the includes for the content I added to the assembly:

````
include::modules/con-oauth-authentication-flow.adoc[leveloffset=+1]
include::modules/con-oauth-authentication-broker.adoc[leveloffset=+1]
include::modules/con-oauth-authentication-client.adoc[leveloffset=+1]
include::modules/con-oauth-authentication-client-options.adoc[leveloffset=+1]
include::modules/con-oauth-config.adoc[leveloffset=+1]
include::modules/con-oauth-server-examples.adoc[leveloffset=+1]
````

I grouped the procedures in the [`con-oauth-config.adoc`](https://github.com/strimzi/strimzi-kafka-operator/blob/master/documentation/modules/oauth/con-oauth-config.adoc) file, as the order is important:

````
include::proc-oauth-server-config.adoc[leveloffset=+1]
include::proc-oauth-broker-config.adoc[leveloffset=+1]
include::proc-oauth-client-config.adoc[leveloffset=+1]
include::proc-oauth-kafka-config.adoc[leveloffset=+1]
````

When you’ve created your assembly, and the modules it contains, you can add it to any guide that needs it with an include statement:

````
include::oauth/assembly-oauth.adoc[leveloffset=+1]
````

You can add the include statement in the `master.adoc` file used to build the guide, or nest the assembly in another assembly. Think of the assembly as a plugin.

I needed to decide where I wanted to position this information in the Strimzi documentation.
The best place was with the _Deployment Configuration_ content of the _Using Strimzi_ guide,
so I added the assembly as a nested assembly to the [Deployment Configuration assembly (`assembly-deployment-configuration.adoc`)](https://github.com/strimzi/strimzi-kafka-operator/blob/master/documentation/assemblies/assembly-deployment-configuration.adoc).
It might not stay there, but that’s where it sits for now.
Anything’s possible with assemblies!
You might see the structure of the documentation evolve as we introduce new guides or find other ways to present information.

After checking that the new assembly was included correctly in the build,
I was able to push up my new assembly to the Strimzi repo as a pull request, where it could be reviewed before merging in.
But that’s never the end of the story...

## Editing Strimzi documentation

Typically, contributions to the documentation involve edits to the current content.
And it’s pretty straightforward.

Let’s suppose your keen eye spots an inaccuracy in the Oauth 2.0 assembly content that you think should be corrected.
What are you going to do?
That’s right, you’re not going to ignore it and hope someone else picks it up, you’re going to make the correction.

The easiest way to update the content is to click the edit icon on the page that needs updating and start [editing in your fork of the Strimzi repository](https://help.github.com/en/github/managing-files-in-a-repository/editing-files-in-another-users-repository).

![Doc edit from Git](/assets/2020-02-14-doc-edit.png)

Request your change.
And don’t worry about refining your prose or perfecting a turn of phrase.
Contributors are always at hand to make sure the docs stay coherent and don’t drift from their purpose.
The important thing is that the inaccuracy was spotted and something is being done about it. Thanks!

## Join in

So that was a brief explanation of how assemblies are created for the Strimzi documentation.
The same approach can also be applied to creating modules for current assemblies.

The Strimzi documentation is, and always will be, work in progress.
But with your help we can shape it so that it provides the right level of support in the right places.

After all, this is documentation of the Strimzi community, by the Strimzi community and for the Strimzi community.
Join in!
