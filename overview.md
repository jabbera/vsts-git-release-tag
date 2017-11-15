# Tag or Branch Git Source on Release

I find tagging or branching sources on every build is too much noise. There are so many builds that are just thrown away and never make it out of CI. I prefer to tag\branch when I get to a specific environment with the artificats. Usually UAT or production. This is a vsts plugin that will git tag or branch artifact source code with the release name. This makes it very easy to patch in the future if needed. When the task runs it finds all linked artifacts that originated from a TfsGit source repo and tags or branches them with the release name. This is meant to be super simple. Just drop in your release pipeline and go. If you wish to configure a regular expression and pattern for the replacement that is also possible using the advanced settings.

Note: Currently this take does not support directly linked TfsGit artifacts. They must currently go though a build. Once [this](https://github.com/Microsoft/vsts-agent/issues/976) is fixed, those can be supported as well. I have no plans to support external git repos.

Advanced Settings Documentation:

Tagging and Branching

You can control the name of the tag or branch by using the advanced settings. The simpilest option is to set a static name: DEV, PRD, UAT etc.

More complex you can specify a regex that MUST match the release name while including one or more capture groups. ([Regex modifiers](https://www.w3schools.com/jsref/jsref_obj_regexp.asp) are also settable via the RegEx flags setting). Using the replacement pattern you can reference the capture groups from the regex to build the desired string. 

For example:

> Release Name Format: Core Release-\$(Build.BuildNumber)-\$(rev:r)
> Release Name Instance Example: Release 3.0.17270.8-1
> Regex: Core Release-([0-9]+.[0-9]+.[0-9]+.[0-9]+)-[0-9]+
> Replacement Pattern: v$1

This would yield a tag or branch on the source artifacts of: v3.0.17270.8

Branching:

The branch folder allows you to specify a subfolder to branch to. Adding to the example above. If the Branch Folder was set to: 'patch' the ref that would be created is: /refs/heads/patch/v3.0.17270.8

  * Chnages in 4.0.X
    * Upgrade packages
  * Changes in 3.0.3
    * Require minimum agent version 2.105.7
    * Print old commit id in log
  * Changes in 3.0.1
    * Allow configuration of a static ref name
    * Allow the updating of a ref
  * Changes in 2.0.5
    * Fix label for "Sample String"
    * Update documentation
  * Changes in 2.0.2
    * New branch task

Icons made by Dave Gandy from http://www.flaticon.com is licensed by CC 3.0 BY