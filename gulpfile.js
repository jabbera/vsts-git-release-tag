var gulp = require('gulp');
var ts = require('gulp-typescript');
var sourcemaps = require('gulp-sourcemaps');
var tsPaths = require('./tsconfig.json')

var tsProject = ts.createProject('tsconfig.json');
var exitOnError = require('yargs').argv.exitOnError;
let errorCount = 0;

gulp.task('compile', function () {

    return tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(tsProject())
        .once("error", function () {
            this.once("finish", () => {
                if (exitOnError) {
                    process.exit(1);
                }
            })
        }
        ).js
        .pipe(sourcemaps.write(".", { sourceRoot: "" }))
        .pipe(gulp.dest('Tasks'));
});

gulp.task('build', gulp.series('compile', function () {
    return gulp.src(['Tasks/common/*', '!Tasks/common/*.ts'])
        .pipe(gulp.dest('Tasks/git-branch-on-release-task/'))
        .pipe(gulp.dest('Tasks/git-tag-on-release-task/'));
}));

gulp.task('watch', gulp.series('build', function () {
    gulp.watch(tsPaths.include, gulp.series('build'));
}));