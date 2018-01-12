import * as vsts from "vso-node-api";
import * as bld from "vso-node-api/BuildApi";
import * as git from "vso-node-api/GitApi";
import * as bldi from "vso-node-api/interfaces/BuildInterfaces";
import * as giti from "vso-node-api/interfaces/GitInterfaces";
import * as tl from "vsts-task-lib/task";
import IArtifactData from "./IArtifactData";

export abstract class GitRefCreator {
    readonly defaultSearchPattern: string = "\\s+";
    readonly defaultRegexFlags: string = "g";
    readonly defaultReplacePattern: string = "";
    readonly defaultStaticTagName: string = "";
    readonly permissionTemplate: string = "You must grant the build account access to permission: ";

    protected abstract get refName(): string;

    protected constructor() {
        this.printVersion();
    }

    public async run() {
        try {

            let token: string = tl.getEndpointAuthorizationParameter("SYSTEMVSSCONNECTION", "AccessToken", false);
            let collectionUrl: string = tl.getEndpointUrl("SYSTEMVSSCONNECTION", false).replace(".vsrm.visualstudio.com", ".visualstudio.com"); // need build
            let authHandler = vsts.getPersonalAccessTokenHandler(token);
            let connect = new vsts.WebApi(collectionUrl, authHandler);

            let gitapi: git.IGitApi = connect.getGitApi();
            let bldapi: bld.IBuildApi = connect.getBuildApi();

            let artifactData: IArtifactData[] = await this.getAllGitArtifacts(bldapi);

            if (artifactData.length === 0) {
                tl.warning("No TfsGit artifacts found.");
            }

            for (let artifact of artifactData) {
                await this.processArtifact(artifact, gitapi);
            }
        } catch (err) {
            tl.setResult(tl.TaskResult.Failed, err.message);
        }
    }

    protected generateRef(releaseName: string, prefix: string): string {
        let staticTagName: string = this.getInputOrDefault("staticTagName", this.defaultStaticTagName);
        let searchRegex: string = this.getInputOrDefault("searchRegex", this.defaultSearchPattern);
        let regexFlags: string = this.getInputOrDefault("regexFlags", this.defaultRegexFlags);
        let replacePattern: string = this.getInputOrDefault("replacePattern", this.defaultReplacePattern);

        tl.debug(`Search Regex: '${searchRegex}', Replace Pattern: '${replacePattern}', flags: '${regexFlags}', staticTagName: '${this.defaultStaticTagName}'`);

        let refName: string = null;
        if (staticTagName !== "") {
            refName = staticTagName;
        }
        else {
            let regex: RegExp = new RegExp(searchRegex, regexFlags);
            refName = releaseName.replace(regex, replacePattern);
        }

        refName = `${prefix}${refName}`;
        tl.debug(`RefName: '${refName}'`);

        return refName;
    }

    private getInputOrDefault(inputName: string, defaultValue: string): string {
        let value: string = tl.getInput(inputName, false);
        if (value != null) {
            return value;
        }

        return defaultValue;
    }

    private async getAllGitArtifacts(bldapi: bld.IBuildApi): Promise < IArtifactData[] > {
        let artifactNames: IArtifactData[] = [];
        let regexp: RegExp = new RegExp("RELEASE\.ARTIFACTS\.(.*)\.REPOSITORY\.PROVIDER", "gi");

        for (let variableInfo of tl.getVariables()) {
            let match: RegExpExecArray = regexp.exec(variableInfo.name);
            if (match === null) {
                tl.debug(`No match for variable: ${variableInfo.name}`);
                continue;
            }

            if (variableInfo.value !== "TfsGit") {
                tl.debug(`Matching variable:  ${variableInfo.name}, but artifact type: ${variableInfo.value}`);
                continue;
            }

            let name: string = match[1];
            tl.debug(`Getting repository id for artifact: ${name}`);
            let repositoryId: string = await this.getRepositoryIdFromBuildNumber(bldapi, name); // This should really be available via a variable
            if (repositoryId == null) {
                continue; // Error already logged
            }

            let artifact: IArtifactData = {
                "name": name,
                "commit": tl.getVariable(`RELEASE.ARTIFACTS.${name}.SOURCEVERSION`),
                "repositoryId": repositoryId,
                "oldCommitId": "0000000000000000000000000000000000000000",
            };

            artifactNames.push(artifact);
        }

        return artifactNames;
    }

    private async getRepositoryIdFromBuildNumber(bldapi: bld.IBuildApi, name: string): Promise < string > {
        let buildidVariable: string = `RELEASE.ARTIFACTS.${name}.BUILDID`;
        let buildid: string = tl.getVariable(buildidVariable);

        if (buildid === null || buildid === "") {
            tl.setResult(tl.TaskResult.Failed, `Unable to get build id from variable: ${buildidVariable}`);
            return null;
        }

        let build: bldi.Build = await bldapi.getBuild(Number(buildid));
        tl.debug(`Got repositoryid: ${build.repository.id}`);
        return build.repository.id;
    }

    protected async processArtifact(artifact: IArtifactData, gitapi: git.IGitApi) {
        tl.debug(`Processing artifact: '${artifact.name}' for ref: ${this.refName} new commit: ${artifact.commit} old commit ${artifact.oldCommitId}`);

        // Do this here instead of during population to avoid : https://github.com/jabbera/vsts-git-release-tag/issues/20
        await this.populateExistingRefCommit(artifact, this.refName, gitapi);

        // See if there is a matching ref for the same commit. We won't overwrite an existing ref. Done after the update so all refs don't need to be brought back every time.
        if (artifact.oldCommitId === artifact.commit) {
            tl.debug("Found matching ref for commit.");
            return true;
        }

        let localRefName: string = `refs/${this.refName}`;
        let updateResult: giti.GitRefUpdateResult = await this.updateRef(artifact, localRefName, gitapi);
        if (updateResult.success) {
            tl.debug("Ref updated!");
            return;
        }

        switch (updateResult.updateStatus) {
            case giti.GitRefUpdateStatus.CreateBranchPermissionRequired:
                tl.error(`${this.permissionTemplate}Create Branch`);
                break;
            case giti.GitRefUpdateStatus.CreateTagPermissionRequired:
                tl.error(`${this.permissionTemplate}Create Tag`);
                break;
        }

        tl.error(`If you need to change permissions see: _admin/_versioncontrol?_a=security&repositoryId=${artifact.repositoryId}`);

        tl.setResult(tl.TaskResult.Failed, `Unable to create ref: ${this.refName} UpdateStatus: ${updateResult.updateStatus} RepositoryId: ${updateResult.repositoryId} Commit: ${updateResult.newObjectId}`);
    }
    private async populateExistingRefCommit(artifact: IArtifactData, refName: string, gitapi: git.IGitApi) {
        let refs: giti.GitRef[] = await gitapi.getRefs(artifact.repositoryId, null, refName);
        if (refs == null) {
            return;
        }

        let foundRef: giti.GitRef = refs.find((x) => x.name.endsWith(refName));
        if (foundRef == null) {
            return;
        }

        artifact.oldCommitId = foundRef.objectId;
    }
    private async updateRef(artifact: IArtifactData, refName: string, gitapi: git.IGitApi): Promise < giti.GitRefUpdateResult > {
        let ref: giti.GitRefUpdate = {
            "isLocked": false,
            "name": refName,
            "newObjectId": artifact.commit,
            "oldObjectId": artifact.oldCommitId,
            "repositoryId": artifact.repositoryId,
        };

        let refArray: giti.GitRefUpdate[] = [ref];
        let updateRefsResult: giti.GitRefUpdateResult[] = await gitapi.updateRefs(refArray, artifact.repositoryId);
        if (updateRefsResult == null || updateRefsResult.length === 0) {
            tl.warning(`No update result returned from updateRefs`);
            return null;
        }

        return updateRefsResult[0];
    }

    private printVersion() {
        try {
            let taskData = require("./task.json");
            console.log(`${taskData.name}: Version: ${taskData.version.Major}.${taskData.version.Minor}.${taskData.version.Patch}`);
        } catch (Err) {
            console.log("Unknown version number");
        }
    }
}