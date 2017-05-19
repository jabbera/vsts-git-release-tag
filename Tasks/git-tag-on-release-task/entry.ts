import * as vsts from "vso-node-api";
import * as bld from "vso-node-api/BuildApi";
import * as git from "vso-node-api/GitApi";
import * as bldi from "vso-node-api/Interfaces/BuildInterfaces";
import * as giti from "vso-node-api/Interfaces/GitInterfaces";
import * as tl from "vsts-task-lib/task";

async function run() {
    try {
        printVersion();

        let token: string = tl.getEndpointAuthorizationParameter("SystemVssConnection", "AccessToken", false);
        let collectionUrl: string = tl.getEndpointUrl("SystemVssConnection", false).replace(".vsrm.visualstudio.com", ".visualstudio.com"); // need build
        let authHandler = vsts.getPersonalAccessTokenHandler(token);
        let connect = new vsts.WebApi(collectionUrl, authHandler);

        let gitapi: git.IGitApi = connect.getGitApi();
        let bldapi: bld.IBuildApi = connect.getBuildApi();

        let artifactData: IArtifactData[] = await getAllGitArtifacts(bldapi);

        if (artifactData.length === 0) {
            tl.warning("No TfsGit artifacts found.");
        }

        for (let artifact of artifactData) {
            await processArtifact(artifact, gitapi);
        }
    }
    catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

async function processArtifact(artifact: IArtifactData, gitapi: git.IGitApi) {
    let releaseName: string = tl.getVariable("RELEASE_RELEASENAME").replace(" ", "");
    let tagName: string = `refs/tags/${releaseName}`;

    tl.debug(`Processing artifact: '${artifact.name}' for tag: ${tagName} new commit: ${artifact.commit}`);

    let updateResult: giti.GitRefUpdateResult = await updateTag(artifact, tagName, gitapi);
    if (updateResult.success) {
        tl.debug("Tag updated!");
        return;
    }

    // See if there is a matching tag for the same commit. We won't overwrite an existing tag. Done after the update so all refs don't need to be brought back every time.
    if (await doesTagExist(artifact, tagName, gitapi)) {
        return;
    }

    tl.setResult(tl.TaskResult.Failed, `Unable to create tag: ${tagName} UpdateStatus: ${updateResult.updateStatus} RepositoryId: ${updateResult.repositoryId} Commit: ${updateResult.newObjectId}`);
}

async function doesTagExist(artifact: IArtifactData, tagName: string, gitapi: git.IGitApi): Promise<boolean> {
    let refs: giti.GitRef[] = await gitapi.getRefs(artifact.repositoryId);
    if (refs == null) {
        return false;
    }

    let foundRef: giti.GitRef = refs.find((x) => x.name === tagName);
    if (foundRef == null) {
        return false;
    }

    if (foundRef.objectId === artifact.commit) {
        tl.debug("Found matching tag for commit.");
        return true;
    }

    tl.warning(`Tag exists, but on different commit. New commit: ${artifact.commit} Old Commit: ${foundRef.objectId}`);
    return false;
}

async function updateTag(artifact: IArtifactData, tagName: string, gitapi: git.IGitApi): Promise<giti.GitRefUpdateResult> {
    let tag: giti.GitRefUpdate = {
        "isLocked": false,
        "name": tagName,
        "newObjectId": artifact.commit,
        "oldObjectId": "0000000000000000000000000000000000000000",
        "repositoryId": artifact.repositoryId,
    };

    let tagArray: giti.GitRefUpdate[] = [tag];
    let updateRefsResult: giti.GitRefUpdateResult[] = await gitapi.updateRefs(tagArray, artifact.repositoryId);
    if (updateRefsResult == null || updateRefsResult.length === 0) {
        tl.warning(`No update result returned from updateRefs`);
        return null;
    }

    return updateRefsResult[0];
}

async function getAllGitArtifacts(bldapi: bld.IBuildApi): Promise<IArtifactData[]> {
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
        let repositoryId: string = await getRepositoryIdFromBuildNumber(bldapi, name); // This should really be available via a variable
        if (repositoryId == null) {
            continue; // Error already logged
        }

        let artifact: IArtifactData = {
            "name": name,
            "commit": tl.getVariable(`RELEASE.ARTIFACTS.${name}.SOURCEVERSION`),
            "repositoryId": repositoryId,
        };

        artifactNames.push(artifact);
    }

    return artifactNames;
}

async function getRepositoryIdFromBuildNumber(bldapi: bld.IBuildApi, name: string): Promise<string> {
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

function printVersion() {
    try {
        let taskData = require("./task.json");
        console.log(`${taskData.name}: Version: ${taskData.version.Major}.${taskData.version.Minor}.${taskData.version.Patch}`);
    }
    catch (Err) {
        console.log("Unknown version number");
    }
}

run();